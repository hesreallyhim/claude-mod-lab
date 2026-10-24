// The compaction workshop, on the X-ray page: the lab's compactor turned on and
// off, a compaction started from the page, and each compaction in the session
// drawn as its messages before and after.

import { titledNotes } from './page.js'
import { clockTime, el } from './view.js'

// How long the Compact button waits for its second press.
const ARM_MS = 5_000

function count(number) {
  return number.toLocaleString('en-US')
}

function sizeOf(one) {
  if (one.tokensBefore === null) return ''
  const after =
    one.tokensAfter === null
      ? one.sizedBy === 'request'
        ? 'a size the next request will measure'
        : 'a size not recorded'
      : count(one.tokensAfter)
  if (one.sizedBy === 'request')
    return `; a request's whole input ${count(one.tokensBefore)} tokens before, ${after} after`
  return `; ${count(one.tokensBefore)} tokens to ${after}${one.sizedBy === 'engine' ? ", by the engine's count" : ''}`
}

/** A compaction in one line, as `/mod-lab compactor` words it. */
function lineOf(one) {
  const head = `${clockTime(one.at)} ${one.trigger}${one.agentId === null ? '' : ` (agent ${one.agentId})`}, by ${one.by}`
  if (one.skipped !== null) return `${head}: skipped, ${one.skipped}`
  const cost =
    one.summarizer !== null
      ? `; the summarizer read ${count(one.summarizer.input)} tokens and wrote ${count(one.summarizer.output)}`
      : one.by === 'mod-lab'
        ? '; no model call'
        : ''
  return `${head}: ${one.before.length} messages to ${one.after.length}${sizeOf(one)}${cost}`
}

/** Messages as blocks whose widths follow their sizes, the strip as wide as its share of `widest`. */
function strip(messages, widest, kindOf) {
  const chars = messages.reduce((sum, message) => sum + message.chars, 0)
  return el(
    'div',
    { class: 'strip', style: `width: ${Math.min(100, Math.max(2, (100 * chars) / Math.max(1, widest)))}%` },
    ...messages.map(message =>
      el('span', {
        class: `msg ${message.role} ${kindOf(message)}`,
        style: `flex-grow: ${Math.max(1, message.chars)}`,
        title: `${message.role}, ${count(message.chars)} characters, ${kindOf(message)}: ${message.preview}`,
      }),
    ),
  )
}

function compactionView(one) {
  const header = el('header', {}, lineOf(one))
  if (one.skipped !== null) return el('article', { class: 'compaction skipped' }, header)
  const total = messages => messages.reduce((sum, message) => sum + message.chars, 0)
  // One scale for both strips; an engine's summary can be longer than what it replaced.
  const widest = Math.max(total(one.before), total(one.after))
  return el(
    'article',
    { class: 'compaction' },
    header,
    el(
      'div',
      { class: 'strips' },
      el('span', { class: 'muted' }, 'before'),
      strip(one.before, widest, message => (message.isKept ? 'kept' : 'dropped')),
      el('span', { class: 'muted' }, 'after'),
      strip(one.after, widest, message => (message.isKept ? 'kept' : 'built')),
    ),
    el(
      'details',
      {},
      el('summary', {}, `the ${one.after.length} messages after`),
      el(
        'ol',
        { class: 'after' },
        ...one.after.map(message =>
          el(
            'li',
            {},
            el('span', { class: `reader ${message.isKept ? 'both' : 'model'}` }, message.isKept ? 'kept' : 'built'),
            ` ${message.role}: ${message.preview}`,
          ),
        ),
      ),
    ),
  )
}

/** Redraws the live part in place, leaving the forms as typed. */
export function refreshCompaction(state) {
  const live = document.querySelector('[data-live="compaction"]')
  if (live === null) return
  const { keep, compactions } = state.mirror.compactor
  const status =
    keep === null
      ? "The lab's compactor is off: compactions are the engine's, and its summarizer is a model request."
      : `The lab's compactor is on: a compaction keeps the first message and the last ${keep}, with a summary the lab writes between them, and makes no model call.`
  if (compactions.length === 0) {
    live.replaceChildren(
      el('p', { class: 'muted readings-summary' }, status),
      el('p', { class: 'muted' }, 'No compaction in this session yet: /compact in the session, or Compact now above.'),
    )
    return
  }
  const legend = el(
    'p',
    { class: 'legend' },
    el('span', { class: 'msg user kept' }),
    ' user ',
    el('span', { class: 'msg assistant kept' }),
    ' assistant ',
    el('span', { class: 'msg user dropped' }),
    ' dropped ',
    el('span', { class: 'msg user built' }),
    ' written for the compaction; widths follow the characters in each message',
  )
  live.replaceChildren(
    el('p', { class: 'muted readings-summary' }, status),
    legend,
    ...[...compactions].reverse().map(compactionView),
  )
}

/** `ctx`: the page's `state` and `sendCommand(text, target)`. */
export function compactionSection(ctx) {
  const { state, sendCommand } = ctx
  const status = el('div', { class: 'result' })
  const setting = el(
    'form',
    {
      class: 'inline-form',
      onsubmit: event => {
        event.preventDefault()
        const keep = String(new FormData(event.currentTarget).get('keep') ?? '').trim()
        void sendCommand(event.submitter?.value === 'off' ? 'compactor off' : `compactor keep ${keep}`, status)
      },
    },
    el(
      'label',
      {},
      'Keep the last ',
      el('input', { name: 'keep', type: 'number', min: 1, max: 50, value: state.mirror.compactor.keep ?? 4 }),
      ' messages',
    ),
    el('button', { type: 'submit', value: 'on' }, "Turn the lab's compactor on"),
    el('button', { type: 'submit', value: 'off', class: 'quiet' }, 'Turn it off'),
  )
  // The first press arms the button for ARM_MS; a second press within that time compacts.
  let armedUntil = 0
  const compact = el(
    'button',
    {
      type: 'button',
      class: 'quiet',
      onclick: event => {
        const button = event.currentTarget
        const isArmed = Date.now() <= armedUntil
        armedUntil = isArmed ? 0 : Date.now() + ARM_MS
        button.textContent = isArmed ? 'Compact now' : 'Press again to compact: a compaction is not undone'
        if (isArmed) void sendCommand('compact', status)
        else setTimeout(() => Date.now() > armedUntil && (button.textContent = 'Compact now'), ARM_MS + 50)
      },
    },
    'Compact now',
  )
  queueMicrotask(() => refreshCompaction(state))
  // The compactor's controls and its readings share one section: the e2e check and the page both know it as section.compactor.
  return el(
    'section',
    { class: 'compactor readings' },
    el('div', { class: 'readings-head' }, el('h2', {}, 'Compaction')),
    el(
      'p',
      { class: 'muted readings-summary' },
      "The lab's compactor stands in for the engine's summarizer, with no model call. A compaction is not undone, so Compact now asks for a second press.",
    ),
    setting,
    compact,
    status,
    el('div', { 'data-live': 'compaction' }),
    titledNotes(
      'How compaction works',
      "A compaction puts a shorter conversation in place of the one so far, when it nears the context window or when asked (/compact). Every compaction passes session.compact. The engine answers it with a summary its summarizer writes, a model request. The lab's compactor answers it first: it keeps the first message and the last few, and writes the summary between them itself from counts.",
      'A command typed in the session cannot compact, since it holds the turn. Where an organization manages Claude Code, session.compact hooks do not run in plugins the person installed, so there the lab neither answers compactions nor lists them here.',
    ),
  )
}
