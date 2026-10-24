// The Model workbench: completions sent from the page through the lab, with
// a prefix the prompt cache can keep, a fork over the session's own
// conversation, and what every model call in the session cost.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { controls, lede, modelSelect, notes, readings, titledNotes } from './page.js'
import { el, fill } from './view.js'

/** How long a cached prefix lasts after its last use. */
export const CACHE_MS = 5 * 60_000
const SAMPLES = [
  ['', 'type your own'],
  ['short', 'lorem ipsum, short: about 3,000 tokens'],
  ['long', 'lorem ipsum, long: about 10,500 tokens'],
]

const count = n => n.toLocaleString('en-US')

/** Free mode: the lab's intercepts that answer its own model calls, which the meter page names by their reply. */
export function isFreeMode(intercepts) {
  return ['model.complete', 'model.fork'].every(event =>
    intercepts.some(
      one => one.event === event && one.behavior === 'answer' && String(one.value?.text ?? '').startsWith('Free mode'),
    ),
  )
}

/** One line over the calls: the model calls the session's plugins made (not the conversation's own), what reached the model, and what the cache served. */
export function spendSummary(spend, intercepts) {
  const totals = Object.values(spend?.totals ?? {})
  const sum = key => totals.reduce((all, total) => all + (total[key] ?? 0), 0)
  const calls = sum('calls')
  const free = isFreeMode(intercepts) ? ' · free mode' : ''
  if (calls === 0) return `no model calls yet${free}`
  return `model calls ${calls} (${sum('sent')} sent) · in ${count(sum('input'))} · out ${count(sum('output'))} · cache read ${count(sum('cacheRead'))}${free}`
}

/** A plugin's model calls averaged per call, the score of a challenge that spends: null before its first. */
export function perCall(spend, plugin) {
  const total = spend?.totals?.[plugin]
  if (total === undefined || total.calls === 0) return null
  const each = key => count(Math.round(total[key] / total.calls))
  return `${plugin} in this session: ${total.calls} model call${total.calls === 1 ? '' : 's'}, ${total.sent} sent. Per call: new input ${each('input')}, cache read ${each('cacheRead')}, cache written ${each('cacheWrite')}, output ${each('output')}.`
}

/** A bar of what a call's input was: written to the cache, read from it, and new. */
function inputBar(usage, widest) {
  const part = (tokens, kind) =>
    el('span', {
      class: `part ${kind}`,
      style: `width: ${(100 * tokens) / Math.max(1, widest)}%`,
      title: `${count(tokens)} ${kind}`,
    })
  return el(
    'span',
    { class: 'input-bar' },
    part(usage.cacheWrite, 'written'),
    part(usage.cacheRead, 'read'),
    part(usage.input, 'new'),
  )
}

/** What the input bar's colours mean, above the table. */
function callsLegend() {
  return el(
    'p',
    { class: 'calls-legend' },
    el('span', {}, el('span', { class: 'part written' }), 'input written to the cache'),
    el('span', {}, el('span', { class: 'part read' }), 'read from the cache'),
    el('span', {}, el('span', { class: 'part new' }), 'new, paid in full'),
  )
}

/** The newest calls, one row each: who called, what, whether it was sent, its input as a bar with the total, its output and its time. */
function callsTable(calls) {
  if (calls.length === 0)
    return el(
      'p',
      { class: 'muted' },
      'No model call yet. Use Complete below; the second call with the same prefix reads it from the cache.',
    )
  const shown = calls.slice(-12).reverse()
  const total = usage => usage.cacheWrite + usage.cacheRead + usage.input
  const widest = Math.max(...shown.map(call => (call.usage === null ? 0 : total(call.usage))))
  const head = ['#', 'plugin', 'call', 'sent', 'input', 'output', 'ms']
  return [
    callsLegend(),
    el(
      'table',
      { class: 'facts calls' },
      el('thead', {}, el('tr', {}, ...head.map(label => el('th', {}, label)))),
      el(
        'tbody',
        {},
        ...shown.map(call => {
          const usage = call.usage
          const title = call.isSent ? 'the call reached the model' : 'a hook answered the call: nothing was sent'
          const detail =
            usage === null
              ? ''
              : `${count(usage.cacheWrite)} written, ${count(usage.cacheRead)} read, ${count(usage.input)} new`
          return el(
            'tr',
            { class: call.isSent ? '' : 'unsent', title },
            el('td', {}, `#${call.seq}`),
            el('td', {}, call.plugin),
            el('td', {}, `${call.event.slice('model.'.length)}${call.model === null ? '' : ` ${call.model}`}`),
            el('td', { class: 'sent' }, call.isSent ? 'sent' : 'not sent'),
            el(
              'td',
              { class: 'input', title: detail },
              usage === null ? '' : [inputBar(usage, widest), count(total(usage))],
            ),
            el('td', { class: 'num' }, usage === null ? '' : count(usage.output)),
            el('td', { class: 'num' }, String(call.ms)),
          )
        }),
      ),
    ),
  ]
}

/** When the newest cached prefix lapses: five minutes after the last call that wrote or read it. */
export function cacheClock(calls, now) {
  const last = calls.findLast(
    call => call.isSent && call.usage !== null && call.usage.cacheWrite + call.usage.cacheRead > 0,
  )
  if (last === undefined) return 'Nothing cached yet.'
  const left = last.at + last.ms + CACHE_MS - now
  if (left <= 0) return `The prefix cached by #${last.seq} has lapsed; the next call writes it again.`
  const seconds = Math.ceil(left / 1000)
  return `The prefix cached by #${last.seq} lapses in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}, five minutes after its last use; each read starts the five minutes again.`
}

let ticking = null

/** Redraws the live parts in place, leaving the forms as typed. */
export function refreshWorkbench(state) {
  const live = document.querySelector('[data-live="workbench"]')
  if (live === null) {
    clearInterval(ticking)
    ticking = null
    return
  }
  const calls = state.mirror.spend?.calls ?? []
  fill(
    live,
    el('p', { id: 'spend', class: 'readings-summary' }, spendSummary(state.mirror.spend, state.mirror.intercepts)),
    el('p', { class: 'muted readings-summary', 'data-clock': '' }, cacheClock(calls, Date.now())),
    callsTable(calls),
  )
  const free = document.querySelector('[data-free]')
  if (free !== null) free.textContent = isFreeMode(state.mirror.intercepts) ? 'Turn free mode off' : 'Turn free mode on'
  ticking ??= setInterval(() => {
    const clock = document.querySelector('[data-clock]')
    if (clock === null) refreshWorkbench(state)
    else clock.textContent = cacheClock(state.mirror.spend?.calls ?? [], Date.now())
  }, 1000)
}

/** `ctx`: the page's `state`, `queueRun(probe, args, target)` and `sendCommand(text, target)`. */
export function workbenchPage(ctx) {
  const { state, queueRun, sendCommand } = ctx
  const reply = el('div', { class: 'result' })
  const forkReply = el('div', { class: 'result' })
  const freeStatus = el('div', { class: 'result' })
  const prefix = el('textarea', {
    name: 'prefix',
    rows: 6,
    placeholder: 'Fixed text sent before the prompt. Long enough, and marked, the cache keeps it.',
  })
  const loadSample = async name => {
    if (name === '') return
    prefix.value = (await api(`/api/sample?name=${encodeURIComponent(name)}`)).text
  }
  const form = el(
    'form',
    {
      class: 'probe workbench',
      onsubmit: event => {
        event.preventDefault()
        const data = Object.fromEntries(new FormData(event.currentTarget).entries())
        void queueRun(
          'model.complete',
          {
            prompt: data.prompt,
            model: data.model,
            prefix: data.prefix,
            cache: data.cache === 'on' ? 'yes' : 'no',
            system: data.system,
          },
          reply,
        )
      },
    },
    el('label', {}, el('span', {}, 'model'), modelSelect('model')),
    el('label', {}, el('span', {}, 'system'), el('input', { name: 'system', placeholder: 'optional' })),
    el(
      'label',
      {},
      el('span', {}, 'prefix'),
      el(
        'select',
        { onchange: event => void loadSample(event.currentTarget.value) },
        ...SAMPLES.map(([value, label]) => el('option', { value }, label)),
      ),
    ),
    prefix,
    el(
      'label',
      { class: 'check' },
      el('input', { type: 'checkbox', name: 'cache', checked: true }),
      el('span', {}, ' mark the prefix for the prompt cache'),
    ),
    el(
      'label',
      {},
      el('span', {}, 'prompt'),
      el('input', { name: 'prompt', value: 'In one sentence, what is this text about?' }),
    ),
    el('button', { type: 'submit' }, 'Send'),
    reply,
  )
  const fork = el(
    'form',
    {
      class: 'probe',
      onsubmit: event => {
        event.preventDefault()
        void queueRun('model.fork', { prompt: new FormData(event.currentTarget).get('prompt') }, forkReply)
      },
    },
    el(
      'label',
      {},
      el('span', {}, 'question'),
      el('input', { name: 'prompt', value: 'In one line, what are we working on?' }),
    ),
    el('button', { type: 'submit' }, 'Fork'),
    forkReply,
  )
  const freeSwitch = el(
    'button',
    {
      type: 'button',
      class: 'quiet',
      'data-free': '',
      onclick: () => void sendCommand(isFreeMode(state.mirror.intercepts) ? 'free off' : 'free on', freeStatus),
    },
    isFreeMode(state.mirror.intercepts) ? 'Turn free mode off' : 'Turn free mode on',
  )
  const page = el(
    'div',
    { class: 'page' },
    pageHead('Model workbench'),
    lede(
      'Completions sent through the lab, and what every model call in this session cost: what the cache served, and what was paid in full.',
    ),
    readings('Model calls this session', { aside: freeSwitch }, freeStatus, el('div', { 'data-live': 'workbench' })),
    controls(
      'Complete',
      el(
        'p',
        {},
        'Send the same prefix twice within five minutes: the first call writes it to the prompt cache, the second reads it and pays for the new text alone.',
      ),
      form,
    ),
    titledNotes(
      'Fork the conversation',
      controls(
        'Fork',
        el(
          'p',
          {},
          "A fork sends the session's whole conversation again with one more question at its end; the conversation comes from the cache while it is warm.",
        ),
        fork,
      ),
    ),
    notes(
      'In free mode, the lab answers its own model calls from an intercept and sends nothing: a hook standing in for the model. The switch above the readings turns it on or off.',
      "A completion spends the session's tokens. A cached prefix lasts five minutes after its last use, and each read starts the five minutes again; the bar in each row shows how much of the call's input the cache wrote, how much it served, and how much was new.",
      'A fork runs on the same model with the same tools, all of them denied. Its cache read is the conversation and its new input the question; in a long session that read is large, and free mode answers it without sending.',
    ),
  )
  queueMicrotask(() => refreshWorkbench(state))
  return page
}
