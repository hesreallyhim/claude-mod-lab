// Streams: the two events whose results arrive in pieces. Each process.spawn
// probe run's pieces on a time axis, and each model request's chunks as the
// lab's turn.step hook saw them arrive.

import { pageHead } from './areas.js'
import { controls, lede, notes, readings } from './page.js'
import { clockTime, el, textPreview } from './view.js'

const SPAWN = 'process.spawn'
const NEWEST = 5

const duration = ms => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

/** A stream's arrivals per slice of its time, as bars of a height each; the Turn timeline draws them in a request's bar. */
export function arrivalBars(stream) {
  const most = Math.max(1, ...stream.arrivals)
  return stream.arrivals.map(count => el('span', { style: `height: ${Math.round((100 * count) / most)}%` }))
}

function kindsLine(stream) {
  return Object.entries(stream.kinds)
    .map(([kind, seen]) => `${kind} ${seen.count} (${seen.first}–${seen.last} ms)`)
    .join(', ')
}

/** A spawn run: its pieces as ticks on one time axis, then each piece's text with when it came. */
function spawnView(run) {
  const header = el('header', {}, el('strong', {}, clockTime(run.at)), ` ${run.args.argv}`)
  if (!run.ok) return el('article', { class: 'run' }, header, el('p', { class: 'error' }, run.error))
  const { chunks, code, signal, ms } = run.value
  const span = Math.max(1, ms)
  return el(
    'article',
    { class: 'run', 'data-exit-code': code, 'data-exit-signal': signal ?? '' },
    header,
    el(
      'p',
      { class: 'muted' },
      `${chunks.length} piece${chunks.length === 1 ? '' : 's'} in ${duration(ms)}; ${signal === null ? `exit code ${code}` : `ended by ${signal}`}`,
    ),
    el(
      'div',
      { class: 'stream-axis' },
      ...chunks.map(chunk =>
        el('span', {
          class: `tick ${chunk.stream}`,
          style: `left: ${((100 * chunk.ms) / span).toFixed(2)}%`,
          title: `${chunk.ms} ms · ${chunk.stream}`,
        }),
      ),
    ),
    el('div', { class: 'axis flush' }, el('span', {}, '0'), el('span', {}, duration(ms))),
    el(
      'table',
      { class: 'facts pieces' },
      el(
        'tbody',
        {},
        ...chunks.map(chunk =>
          el(
            'tr',
            { class: chunk.stream },
            el('td', {}, `${chunk.ms} ms`),
            el('td', {}, chunk.stream),
            el('td', {}, textPreview(`${chunk.stream} · ${chunk.ms} ms`, chunk.text)),
          ),
        ),
      ),
    ),
  )
}

function requestView(row) {
  return el(
    'article',
    { class: 'run' },
    el('header', {}, el('strong', {}, clockTime(row.at - row.ms)), ` ${row.summary}`),
    el(
      'p',
      {},
      el('span', { class: 'sparkline', title: 'chunks per slice of the request' }, ...arrivalBars(row.stream)),
      ` ${kindsLine(row.stream)}`,
    ),
  )
}

/** Redraws the live parts in place, leaving the form as chosen. */
export function refreshStreams(state) {
  const live = document.querySelector('[data-live="streams"]')
  if (live === null) return
  const spawns = state.runs
    .filter(run => run.probe === SPAWN)
    .slice(-NEWEST)
    .reverse()
  const requests = state.traces
    .filter(row => row.event === 'turn.step' && row.stream !== undefined)
    .slice(-NEWEST)
    .reverse()
  live.replaceChildren(
    readings(
      'A child process',
      { aside: el('span', { class: 'muted' }, 'stdout in cyan, stderr in red') },
      spawns.length === 0 ? el('p', { class: 'muted' }, 'No spawn run yet: run one above.') : spawns.map(spawnView),
    ),
    readings(
      'Model requests',
      { aside: el('span', { class: 'muted' }, 'chunks per slice of each request') },
      requests.length === 0
        ? el('p', { class: 'muted' }, 'No model request traced yet: send the session a prompt.')
        : requests.map(requestView),
    ),
  )
}

/** `ctx`: the page's `state` and `queueRun(probe, args, target)`. */
export function streamsPage(ctx) {
  const { state, queueRun } = ctx
  const status = el('div', { class: 'result' })
  const choices =
    state.session?.probes?.find(probe => probe.id === SPAWN)?.params.find(param => param.name === 'argv')?.options ?? []
  const form = el(
    'form',
    {
      class: 'inline-form',
      onsubmit: event => {
        event.preventDefault()
        void queueRun(SPAWN, { argv: String(new FormData(event.currentTarget).get('argv')) }, status)
      },
    },
    el('select', { name: 'argv' }, ...choices.map(choice => el('option', { value: choice }, choice))),
    el('button', { type: 'submit' }, 'Run'),
  )
  queueMicrotask(() => refreshStreams(state))
  return el(
    'div',
    { class: 'page' },
    pageHead(
      'Streams',
      notes(
        "A hook on a streaming event is an async generator that passes each piece on as it comes, rewrites it, or drops it. process.spawn hands back a program's output as it comes; the pieces follow the program's own writes rather than its lines, so one line can arrive split across two pieces.",
        "turn.step is a model request, streamed chunk by chunk: text, thinking, tool calls and their input. The lab's hook keeps when each kind of chunk arrived; the Turn timeline draws the same bars inside each request.",
      ),
    ),
    lede("The two events whose results arrive in pieces: a child process's output, and a model request's chunks."),
    controls(
      'Run a child process',
      el('p', {}, 'The process.spawn probe runs a program and keeps each piece of its output with when it arrived.'),
      form,
      status,
    ),
    el('div', { 'data-live': 'streams' }),
  )
}
