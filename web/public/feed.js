// The feed on the right: the session's runs, its traced events and the calls
// intercepts acted on, a tab each, newest first.

import { censusView, inForceList, tapRow } from './intercepts.js'
import { hrefFor } from './reference.js'
import { runRow } from './runs.js'
import { clockTime, el, logRow, payloadView } from './view.js'

/** The mark of a traced event: a model request, a tool call, a command, or a point in the session's or a turn's life. */
const MARK = { 'turn.step': 'request', 'tool.call': 'tool', 'command.run': 'command' }

/** A session event the lab traced: the event and how long it took, what it was, the chain; opened, e and what next(e) resolved to. */
export function traceRow(state, row) {
  return logRow({
    at: row.at,
    name: row.event,
    href: hrefFor(state, row.event),
    mark: MARK[row.event] ?? 'dot',
    outcome: `${row.ms} ms`,
    chain: row.chain,
    what: row.summary,
    parts: [
      ['Input', payloadView(row.input)],
      ['Result', payloadView(row.result)],
    ],
  })
}

const FEED_LIMIT = { runs: 40, trace: 200, taps: 200 }

const seconds = ms => `${(ms / 1000).toFixed(1)} s`

/**
 * The trace as the reader asked for it: each turn with the prompt that started
 * it and the requests and tool calls inside it, and the rows outside any turn
 * on their own, newest first. A turn's rows are those of its loop, the main
 * one or an agent's, from its turn.start to its turn.complete.
 */
export function groupedTrace(rows) {
  const groups = []
  const open = new Map()
  let prompt = null
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const loop = row.input?.agentId ?? null
    const current = open.get(loop)
    if (row.event === 'prompt.submit' && loop === null) {
      prompt = row
      groups.push({ kind: 'row', row, last: row.seq })
      continue
    }
    if (row.event === 'turn.start') {
      // The main loop's turn answers the prompt just before it, which titles the turn and joins it.
      const own = loop === null && prompt !== null && groups.at(-1)?.row === prompt ? groups.pop().row : null
      const turn = {
        kind: 'turn',
        loop,
        prompt: own,
        start: row,
        rows: [...(own === null ? [] : [own]), row],
        end: null,
        last: row.seq,
      }
      groups.push(turn)
      open.set(loop, turn)
      prompt = null
      continue
    }
    if (current !== undefined && ['turn.step', 'tool.call', 'turn.complete'].includes(row.event)) {
      current.rows.push(row)
      current.last = row.seq
      if (row.event === 'turn.complete') {
        current.end = row
        open.delete(loop)
      }
      continue
    }
    groups.push({ kind: 'row', row, last: row.seq })
  }
  return groups.sort((a, b) => b.last - a.last)
}

/**
 * A turn as a group: what was asked, when, how long it took and what it did, with
 * a bar of its requests and tool calls in time; opened, its rows, newest first.
 */
function turnGroup(state, turn, isNewest) {
  const start = turn.start.at
  const end = turn.end?.at ?? Math.max(start, ...turn.rows.map(row => row.at))
  const span = Math.max(1, end - start)
  const items = turn.rows.filter(row => row.event === 'turn.step' || row.event === 'tool.call')
  const bar = items.map(row =>
    el('span', {
      class: row.event === 'turn.step' ? 'req' : 'tool',
      style: `left: ${Math.max(0, ((row.at - row.ms - start) / span) * 100).toFixed(2)}%; width: ${Math.max(0.5, (row.ms / span) * 100).toFixed(2)}%`,
      title: row.summary,
    }),
  )
  const requests = items.filter(row => row.event === 'turn.step').length
  const tools = items.length - requests
  const counts = `${requests} request${requests === 1 ? '' : 's'}, ${tools} tool call${tools === 1 ? '' : 's'}, ${turn.end === null ? 'running' : seconds(span)}`
  const title = turn.prompt === null ? turn.start.summary : turn.prompt.summary
  return el(
    'details',
    { class: 'turn', open: isNewest || null },
    el(
      'summary',
      { title: 'open the turn' },
      el('i', { class: 'mark prompt', 'aria-hidden': 'true' }),
      el(
        'span',
        { class: 'row-name' },
        title,
        turn.loop === null || turn.prompt === null ? null : el('span', { class: 'row-by' }, ` agent ${turn.loop}`),
      ),
      el('span', { class: 'time' }, clockTime(start)),
      el(
        'span',
        { class: 'line2' },
        el('span', { class: 'tl', 'aria-hidden': 'true' }, bar),
        el('span', { class: 'counts' }, counts),
      ),
    ),
    el(
      'div',
      { class: 'turn-rows' },
      [...turn.rows]
        .reverse()
        .filter(row => row.event !== 'turn.start')
        .map(row => traceRow(state, row)),
    ),
  )
}

/** Redraws the Session events tab as the trace grows, since a new row may join a turn; a dialog open there is left until it closes. */
export function refreshTrace(state) {
  if (state.feed !== 'trace') return
  const opened = document.querySelector('#feed-body dialog[open]')
  if (opened === null) renderFeed(state)
  else opened.addEventListener('close', () => refreshTrace(state), { once: true })
}

/** What each tab holds, in a line under the tabs, and what it says while it holds nothing. */
const ABOUT = {
  runs: 'Probe results. Open a run to read its output and API calls.',
  trace: 'Session activity. Open an event to inspect its input, result and hooks.',
  taps: 'Intercepted API calls. Open a call to inspect the input and result.',
}

const EMPTY = {
  runs: "No runs yet. Run a probe from a method's page in the Mod API, or /mod-lab <probe> in the session.",
  trace: 'No session events yet: send the session a prompt.',
  taps: "No intercepted calls yet. An intercept is set from a method's page, or with /mod-lab intercept in the session.",
}

export function renderFeed(state) {
  for (const tab of ['runs', 'trace', 'taps'])
    document.getElementById(`tab-${tab}`).setAttribute('aria-selected', String(state.feed === tab))
  const caption = document.getElementById('feed-caption')
  if (caption !== null) caption.textContent = ABOUT[state.feed]
  const body = document.getElementById('feed-body')
  const empty = () => [el('p', { class: 'muted' }, EMPTY[state.feed])]
  if (state.feed === 'runs') {
    const runs = state.runs.slice(-FEED_LIMIT.runs).reverse()
    body.replaceChildren(...(runs.length === 0 ? empty() : runs.map(run => runRow(state, run))))
  } else if (state.feed === 'trace') {
    const groups = groupedTrace(state.traces.slice(-FEED_LIMIT.trace))
    body.replaceChildren(
      ...(groups.length === 0
        ? empty()
        : groups.map((group, index) =>
            group.kind === 'turn' ? turnGroup(state, group, index === 0) : traceRow(state, group.row),
          )),
    )
  } else {
    const taps = state.taps.slice(-FEED_LIMIT.taps).reverse()
    body.replaceChildren(
      inForceList(state),
      ...(taps.length === 0 ? empty() : [censusView(state.taps), ...taps.map(tapRow)]),
    )
  }
}

/** Adds a new entry on top without redrawing the rest, so what the reader opened stays open. */
export function prependToFeed(state, tab, node) {
  if (state.feed !== tab) return
  const body = document.getElementById('feed-body')
  if (body.querySelector(':scope > p.muted')) body.replaceChildren()
  // The Intercepted tab keeps its census above the rows.
  const census = body.querySelector(':scope > .census')
  if (census === null) body.prepend(node)
  else census.after(node)
  while (body.childElementCount > FEED_LIMIT[tab]) body.lastElementChild?.remove()
}
