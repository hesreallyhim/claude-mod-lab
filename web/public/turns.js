// Turns: the turns of the main loop and of its agents, read from the trace,
// each row by the loop its agentId names. A row's `at` is when its event
// settled and `ms` how long it took, so each bar runs from at - ms to at; a
// model request is its turn.step row, a tool call its tool.call row.

import { pageHead } from './areas.js'
import { lede, notes, readings } from './page.js'
import { arrivalBars } from './streams.js'
import { clockTime, el, jsonTree } from './view.js'

function turnsOf(rows) {
  const turns = []
  const open = new Map()
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const loop = row.input?.agentId ?? null
    const current = open.get(loop)
    if (row.event === 'turn.start') {
      const turn = { loop, id: row.result?.turnId, start: row.at, end: null, reason: null, items: [] }
      turns.push(turn)
      open.set(loop, turn)
    } else if (current === undefined) {
      continue
    } else if (row.event === 'turn.step' && row.input?.turnId === current.id) {
      current.items.push({
        kind: 'model',
        label: `model request ${Number(row.input.index) + 1}`,
        start: row.at - row.ms,
        end: row.at,
        row,
      })
    } else if (row.event === 'tool.call') {
      current.items.push({ kind: 'tool', label: row.summary, start: row.at - row.ms, end: row.at, row })
    } else if (row.event === 'turn.complete') {
      current.end = row.at
      current.reason = row.input?.reason ?? null
      current.items.sort((a, b) => a.start - b.start)
      open.delete(loop)
    }
  }
  return turns.reverse()
}

const seconds = ms => `${(ms / 1000).toFixed(1)} s`

/** An agent's type, from the runs the lab saw spawned, for its turns' label. */
function agentType(state, agentId) {
  const run = state.mirror.agents?.runs?.find(one => one.agentId === agentId)
  return run === undefined ? '' : ` (${run.type})`
}

function metric(label, value) {
  return el('div', {}, el('dt', {}, label), el('dd', {}, value))
}

const eventKey = row => `${row.at}:${row.seq}`

function eventView(item, start, span, opened) {
  const offset = item.start - start
  const duration = item.end - item.start
  const left = Math.max(0, (offset / span) * 100).toFixed(2)
  const width = Math.max(0.5, (duration / span) * 100).toFixed(2)
  return el(
    'details',
    { class: 'timeline-event', 'data-event': eventKey(item.row), open: opened.has(eventKey(item.row)) },
    el(
      'summary',
      { class: `lane ${item.kind}` },
      el('span', { class: 'lane-label' }, item.label),
      el(
        'span',
        { class: 'track', 'aria-hidden': 'true' },
        el(
          'span',
          {
            class: item.row.stream === undefined ? 'segment' : 'segment streamed',
            style: `left: ${left}%; width: ${width}%`,
          },
          item.row.stream === undefined ? null : arrivalBars(item.row.stream),
        ),
      ),
    ),
    el(
      'div',
      { class: 'timeline-event-detail' },
      el('p', {}, item.row.summary),
      el('dl', { class: 'turn-metrics' }, metric('Start offset', `${offset} ms`), metric('Duration', `${duration} ms`)),
      jsonTree(item.row),
    ),
  )
}

function turnView(state, turn, opened) {
  const end = turn.end ?? Math.max(turn.start, ...turn.items.map(item => item.end))
  const span = Math.max(1, end - turn.start)
  const spent = kind =>
    turn.items.filter(item => item.kind === kind).reduce((sum, item) => sum + (item.end - item.start), 0)
  const count = kind => turn.items.filter(item => item.kind === kind).length
  const loop = turn.loop === null ? 'Main loop' : `Agent${agentType(state, turn.loop)}`
  return el(
    'article',
    { class: 'turn' },
    el(
      'header',
      { class: 'turn-heading' },
      el('strong', {}, `${loop} · ${clockTime(turn.start)}`),
      el('span', { class: 'muted' }, turn.reason ? `Ended: ${turn.reason}` : 'Still running'),
    ),
    turn.loop === null ? null : el('p', { class: 'muted turn-agent' }, `Agent id: ${turn.loop}`),
    el(
      'dl',
      { class: 'turn-metrics' },
      metric('Elapsed', seconds(span)),
      metric('Model requests', `${count('model')} · ${seconds(spent('model'))}`),
      metric('Tool calls', `${count('tool')} · ${seconds(spent('tool'))}`),
    ),
    el(
      'div',
      { class: 'timeline' },
      turn.items.map(item => eventView(item, turn.start, span, opened)),
    ),
    el('div', { class: 'axis' }, el('span', {}, '0 s'), el('span', {}, seconds(span))),
  )
}

export function turnsPage(ctx) {
  const { state } = ctx
  const turns = turnsOf(state.traces).slice(0, 10)
  // The trace redraws this page while a reader may have an event open or focused.
  const opened = new Set(
    [...document.querySelectorAll('.timeline-event[open]')].map(node => node.getAttribute('data-event')),
  )
  const focused = document.querySelector('.timeline-event > summary:focus')?.parentElement?.getAttribute('data-event')
  if (focused)
    queueMicrotask(() => {
      const summary = document.querySelector(`.timeline-event[data-event="${focused}"] > summary`)
      if (summary instanceof HTMLElement) summary.focus({ preventScroll: true })
    })
  return el(
    'div',
    { class: 'page', 'data-live': 'turns' },
    pageHead('Turn timeline'),
    lede("Each turn's model requests and tool calls on one time axis, newest first, from the lab's trace."),
    readings(
      'Turns',
      { aside: turns.length === 0 ? null : el('span', { class: 'muted' }, 'newest first, the last ten') },
      turns.length === 0
        ? el('p', { class: 'muted' }, 'No turn traced yet: send the session a prompt.')
        : turns.map(turn => turnView(state, turn, opened)),
    ),
    notes(
      "The turns are the main loop's and those of the agents it or a plugin spawned; an agent's turn is marked with its id. A model request is the turn's turn.step row and a tool call its tool.call row, each drawn from when it started to when it settled.",
      'Open a timeline row to read its summary, exact timing and trace data. The shaded bars inside a model request are its chunks per slice of time, as Streams draws them.',
    ),
  )
}
