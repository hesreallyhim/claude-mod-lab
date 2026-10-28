// Probe runs: a run's card, with each dispatch and the chain beneath the lab
// that answered it, and its calls to copy as test hooks; the probe form; and
// the job queue, which sends probes and /mod-lab commands to the session and draws
// each answer where it was asked for.

import { api } from './api.js'
import { reportView } from './page.js'
import { hrefFor, memberOf } from './reference.js'
import { chainTable, clockTime, compact, el, jsonTree, logRow, openTextDialog, payloadView } from './view.js'

/** Where each job's result is drawn once the session answers it. */
const pending = new Map()
/** Where a job started from a lesson's text says how it went, in a word or two. */
const inlinePending = new Map()

// Runs

/** A chain beneath the lab, led by the lab's own intercept when one acted on the call. */
export function chain(links, intercepted) {
  const lead = intercepted
    ? [el('span', { class: 'link intercept', title: "the lab's own hook" }, `mod-lab intercept (${intercepted})`)]
    : []
  const rest = links.map(one =>
    el(
      'span',
      { class: `link ${one.outcome}`, title: `${one.tier} tier` },
      `${one.plugin} ${one.outcome} ${one.ms} ms${one.chunks === undefined ? '' : `, ${one.chunks} chunks`}`,
      // A link that saw another e than the one passed on: a hook above it rewrote it.
      one.received === undefined
        ? null
        : el(
            'span',
            { class: 'received', title: JSON.stringify(one.received) },
            ` received ${compact(one.received, 60)}`,
          ),
    ),
  )
  return el(
    'div',
    { class: 'chain' },
    [...lead, ...rest].map((node, index) => [index > 0 ? el('span', { class: 'arrow' }, '→') : null, node]),
  )
}

function dispatchList(state, dispatches) {
  if (!dispatches?.length)
    return el(
      'p',
      { class: 'muted' },
      'No dispatch recorded: the probe read plain data, or made a call the lab does not inspect.',
    )
  return el(
    'ol',
    { class: 'dispatches' },
    dispatches.map(dispatch => {
      const href = hrefFor(state, dispatch.event)
      return el(
        'li',
        {},
        el(
          'div',
          { class: 'call' },
          href === null ? dispatch.event : el('a', { href }, dispatch.event),
          el('code', {}, `(${compact(dispatch.received, 140)})`),
        ),
        chain(dispatch.chain, dispatch.intercepted),
        el('details', {}, el('summary', {}, 'Result'), jsonTree(dispatch.returned)),
      )
    }),
  )
}

// A run's calls as bottom hooks for a test, as /mod-lab eject writes them
// (mods/mod-lab/hooks/eject.ts, where the cases are explained).

function answerOf(dispatch) {
  const returned = dispatch.returned
  if (returned === 'pending') return '/* it had not answered when the run ended */ undefined'
  if (returned && typeof returned === 'object' && 'rejected' in returned)
    return `/* the call rejected */ { deny: ${JSON.stringify(String(returned.rejected))} }`
  if (returned && typeof returned === 'object' && 'abandoned' in returned)
    return '/* abandoned at its budget */ undefined'
  if (returned && typeof returned === 'object' && !Array.isArray(returned) && Object.keys(returned).length === 0)
    return '{ value: undefined }'
  return JSON.stringify(returned)
}

function ejectText(run) {
  const lines = [
    `// The calls run #${run.seq} (${run.probe}) made, answered as the session answered them.`,
    "// In a test, these hooks stand beneath the plugin where the engine would; register them before the test's first call on $.",
  ]
  for (const event of new Set(run.dispatches.map(dispatch => dispatch.event))) {
    const calls = run.dispatches.filter(dispatch => dispatch.event === event)
    lines.push('')
    if (calls.length === 1) {
      lines.push(`// received ${JSON.stringify(calls[0].received)}`, `on('${event}', () => (${answerOf(calls[0])}))`)
      continue
    }
    const name = `${event.replace(/\.(\w)/g, (_, letter) => letter.toUpperCase())}Answers`
    lines.push(
      `// ${calls.length} calls, answered in order; each received:`,
      ...calls.map(call => `//   ${JSON.stringify(call.received)}`),
    )
    lines.push(
      `const ${name} = [${calls.map(answerOf).join(', ')}]`,
      `on('${event}', () => (${name}.length > 1 ? ${name}.shift()! : ${name}[0]!))`,
    )
  }
  return lines.join('\n')
}

export function ejectButton(run) {
  if (!run.dispatches?.length) return null
  return el(
    'button',
    {
      type: 'button',
      class: 'quiet',
      'data-action': 'copy-test-hooks',
      title: 'The calls this run made, as bottom hooks for a test',
      onclick: async event => {
        const button = event.currentTarget
        await navigator.clipboard.writeText(ejectText(run))
        button.textContent = 'Copied'
        button.dataset.copyState = 'copied'
      },
    },
    'Copy as test hooks',
  )
}

/** A run's outcome in a word, and the mark and colour that go with it. */
function readingOf(run) {
  if (run.ok) return { status: 'ok', mark: 'ok', tone: 'ok' }
  return { status: 'failed', mark: 'failed', tone: 'bad' }
}

/**
 * A run as a row of the log (view.js logRow), for the feed: the probe, its
 * reading, a short value where there is one, and the chain of its first call;
 * the value, the error, every call it made and the test hooks in its dialog.
 */
export function runRow(state, run) {
  const href = memberOf(state, run.probe) !== undefined ? `#/$/${run.probe}` : '#/probes'
  const { status, mark, tone } = readingOf(run)
  const dispatches = run.dispatches ?? []
  const first = dispatches[0]
  const what = runSummary(run)
  const calls = runCalls(state, dispatches)
  return logRow({
    at: run.at,
    name: run.probe,
    href,
    mark,
    outcome: status,
    tone,
    chain: first?.chain ?? [],
    intercepted: first?.intercepted,
    what,
    note: extraCalls(dispatches.length),
    src: run.from,
    chainTitle: null,
    parts: [
      runResult(run),
      [`API calls (${dispatches.length})`, calls],
      [
        'Reference and testing',
        el(
          'div',
          { class: 'actions' },
          ejectButton(run),
          el('a', { href, class: 'quiet action-link' }, `Open ${run.probe} in the reference`),
        ),
      ],
    ],
  })
}

function runSummary(run) {
  if (!run.ok) return run.error
  const value = JSON.stringify(run.value) ?? ''
  return value.length <= 60 ? jsonTree(run.value) : null
}

function runResult(run) {
  if (run.ok) return ['Result', payloadView(run.value)]
  return ['Error', el('p', { class: 'error' }, run.error)]
}

function extraCalls(count) {
  return count > 1 ? `+${count - 1} more call${count === 2 ? '' : 's'}` : null
}

function runCalls(state, dispatches) {
  if (dispatches.length === 0) return el('p', { class: 'muted' }, 'No API calls were recorded for this run.')
  return dispatches.map(dispatch => {
    const to = hrefFor(state, dispatch.event)
    return el(
      'div',
      { class: 'call-made' },
      el('h4', { class: 'call' }, to === null ? dispatch.event : el('a', { href: to }, dispatch.event)),
      el('div', { class: 'call-input' }, el('h5', {}, 'Input'), payloadView(dispatch.received)),
      el('div', { class: 'call-answer' }, el('h5', {}, 'Result'), payloadView(dispatch.returned)),
      el(
        'details',
        { class: 'detail-secondary' },
        el('summary', {}, 'Hook chain'),
        chainTable(dispatch.chain, dispatch.intercepted),
      ),
    )
  })
}

export function runCard(state, run) {
  const href = memberOf(state, run.probe) !== undefined ? `#/$/${run.probe}` : '#/probes'
  const status = run.ok ? 'ok' : 'failed'
  return el(
    'article',
    { class: `run ${status}`, 'data-probe': run.probe, 'data-status': status },
    el(
      'header',
      {},
      run.seq === undefined ? null : el('span', { class: 'entry-no' }, `#${run.seq}`),
      el('a', { href }, run.probe),
      el('span', { class: 'status' }, status),
      el(
        'span',
        { class: 'run-meta' },
        el('span', { class: 'reading' }, `${run.ms} ms`),
        el('span', {}, `from ${run.from}`),
        run.at ? el('span', { class: 'run-time' }, clockTime(run.at)) : null,
      ),
    ),
    el('div', { class: 'outcome' }, run.ok ? jsonTree(run.value) : el('p', { class: 'error' }, run.error)),
    el(
      'div',
      { class: 'dispatch-head' },
      el('h4', {}, `Dispatches (${run.dispatches?.length ?? 0})`),
      ejectButton(run),
    ),
    dispatchList(state, run.dispatches),
  )
}

// Probes

function field(param, form) {
  const id = `${form}-${param.name}`
  const control =
    param.type === 'choice'
      ? el(
          'select',
          { id, name: param.name, 'aria-describedby': `${id}-hint` },
          param.options.map(option => el('option', { value: option, selected: option === param.default }, option)),
        )
      : el('input', {
          id,
          name: param.name,
          'aria-describedby': `${id}-hint`,
          value: String(param.default),
          type: param.type === 'number' ? 'number' : 'text',
        })
  return el(
    'label',
    { for: id },
    el('span', {}, param.name),
    control,
    el('small', { id: `${id}-hint`, class: 'muted' }, param.description),
  )
}

let forms = 0

/** The same run as `/mod-lab` takes it in the session: one argument as text, more as a JSON object (mods/mod-lab/hooks/args.ts). */
function commandFor(probe, values) {
  const names = probe.params.map(param => param.name)
  if (names.length === 0) return `/mod-lab ${probe.id}`
  if (names.length === 1) return `/mod-lab ${probe.id} ${values[names[0]] ?? ''}`.trimEnd()
  return `/mod-lab ${probe.id} ${JSON.stringify(values)}`
}

/** A line under a form showing the command it amounts to, kept in step as the fields change. */
export function echoLine(label) {
  const code = el('code', {})
  return { line: el('p', { class: 'echo' }, el('span', { class: 'echo-label' }, label), code), code }
}

export function probeForm(state, probe) {
  const name = `probe-${(forms += 1)}`
  const result = el('div', { class: 'result' })
  const echo = echoLine('Equivalent Claude Code command')
  const update = form => {
    echo.code.textContent = commandFor(probe, Object.fromEntries(new FormData(form).entries()))
  }
  const form = el(
    'form',
    {
      class: 'probe',
      'data-probe': probe.id,
      onsubmit: event => {
        event.preventDefault()
        void queueRun(state, probe.id, Object.fromEntries(new FormData(event.currentTarget).entries()), result)
      },
      oninput: event => update(event.currentTarget),
      onchange: event => update(event.currentTarget),
    },
    el(
      'div',
      { class: 'probe-head' },
      el('span', { class: 'probe-label' }, 'Probe'),
      el('strong', {}, probe.id),
      el('span', { class: `effect ${probe.effect}` }, probe.effect),
    ),
    el('p', {}, probe.description),
    probe.params.length === 0
      ? null
      : el(
          'div',
          { class: 'fields' },
          probe.params.map(param => field(param, name)),
        ),
    echo.line,
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'submit' }, el('span', { class: 'run-glyph', 'aria-hidden': 'true' }), 'Run in the session'),
      el(
        'button',
        {
          type: 'button',
          class: 'quiet source',
          'aria-haspopup': 'dialog',
          onclick: () => openTextDialog(`${probe.id} source`, probe.source, 'Close source'),
        },
        'View source',
      ),
    ),
    result,
  )
  update(form)
  return form
}

export function probesHint(state) {
  if (state.session?.isConnected) return null
  return el(
    'p',
    { class: 'hint' },
    'Run npx claude-mod-lab run in your project to start Claude Code with the lab and connect a session. If the lab is installed from its marketplace, a plain claude session can connect too.',
  )
}

/** A command's answer beside its button: a short summary and a modal for the whole text. */
function inlineAnswer(answer) {
  const first = answer.split('\n', 1)[0]
  const summary = first.length > 80 ? `${first.slice(0, 79)}…` : first
  return el(
    'span',
    { class: 'inline-answer' },
    el('span', {}, summary),
    el(
      'button',
      {
        type: 'button',
        class: 'quiet',
        'aria-haspopup': 'dialog',
        onclick: () => openTextDialog('Command response', answer),
      },
      'View response',
    ),
  )
}

/** Queues a probe run in the session; its run card replaces `target`'s contents once the session answers. */
export async function queueRun(state, probe, args, target) {
  target.dataset.probe = probe
  target.dataset.status = 'pending'
  target.replaceChildren(el('p', { class: 'muted' }, 'queued for the session'))
  try {
    const { job } = await api('/api/run', { method: 'POST', body: JSON.stringify({ probe, args }) })
    pending.set(job, { target, renderAnswer: reportView })
    const known = state.jobs.get(job)
    if (known !== undefined) updateJob(state, known)
  } catch (error) {
    target.dataset.status = 'failed'
    target.replaceChildren(el('p', { class: 'error' }, error.message))
  }
}

export function updateJob(state, job) {
  const marker = inlinePending.get(job.id)
  if (marker !== undefined && ['done', 'lost'].includes(job.status)) {
    const ok = job.status === 'done' && (job.kind === 'command' || job.run?.ok)
    const outcome = ok ? 'ok' : 'failed'
    if (job.status === 'done' && job.kind === 'command') marker.replaceChildren(' ', inlineAnswer(job.answer ?? ''))
    else marker.textContent = job.status === 'lost' ? ' lost' : ` ${outcome}, see Runs`
    marker.className = `inline-result ${outcome}`
    marker.dataset.status = ok ? 'done' : 'failed'
    inlinePending.delete(job.id)
  }
  const waiting = pending.get(job.id)
  if (waiting === undefined) return
  const { target, renderAnswer } = waiting
  target.dataset.status = job.status
  if (job.status === 'sent') target.replaceChildren(el('p', { class: 'muted' }, 'running in the session'))
  if (job.status === 'lost') target.replaceChildren(el('p', { class: 'error' }, job.error))
  if (job.status === 'done' && job.run) {
    target.replaceChildren(runCard(state, job.run))
    pending.delete(job.id)
  }
  if (job.status === 'done' && job.kind === 'command') {
    target.replaceChildren(renderAnswer(job.answer ?? ''))
    pending.delete(job.id)
  }
}

/** Queues what follows `/mod-lab` for the session; its answer replaces `target`'s contents. */
export async function sendCommand(state, text, target, renderAnswer = reportView) {
  target.dataset.command = text
  target.dataset.status = 'pending'
  target.replaceChildren(el('p', { class: 'muted' }, 'queued for the session'))
  try {
    const { job } = await api('/api/command', { method: 'POST', body: JSON.stringify({ text }) })
    pending.set(job, { target, renderAnswer })
    const known = state.jobs.get(job)
    if (known !== undefined) updateJob(state, known)
  } catch (error) {
    target.dataset.status = 'failed'
    target.replaceChildren(el('p', { class: 'error' }, error.message))
  }
}

export async function queueInline(state, path, body, marker) {
  marker.dataset.status = 'pending'
  marker.textContent = ' queued'
  try {
    const { job } = await api(path, { method: 'POST', body: JSON.stringify(body) })
    inlinePending.set(job, marker)
    const known = state.jobs.get(job)
    if (known !== undefined) updateJob(state, known)
  } catch (error) {
    marker.dataset.status = 'failed'
    marker.textContent = ` ${error.message}`
  }
}
