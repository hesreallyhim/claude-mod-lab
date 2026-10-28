// Intercepts: the form that sets one on an event in the session, the
// intercept in force there with the calls it acted on, and the taps the
// Intercepted tab lists, with their census above them.

import { api } from './api.js'
import { echoLine, sendCommand } from './runs.js'
import { clockTime, docText, el, logRow, openDataDialog, payloadView } from './view.js'

const BEHAVIORS = [
  ['watch', 'watch: record each call and pass it on'],
  ['refuse', 'refuse: turn each call down; the caller gets { deny }'],
  ['answer', 'answer: return the value below as the result, without passing the call on'],
  ['rewrite', 'rewrite: pass the call on with these fields of its input overwritten'],
  ['delay', 'delay: hold each call for the milliseconds below, then pass it on'],
]

/** The value field as each behavior uses it; watch and refuse take none, so it is hidden for them. */
const VALUE_FIELD = {
  answer: {
    label: 'answer with',
    placeholder: 'the result, as JSON',
    hint: "The caller gets this as the call's result, unchecked. Text that is not JSON is sent as a string.",
  },
  rewrite: {
    label: 'fields to overwrite',
    placeholder: '{"path": "README.md"}',
    hint: "A JSON object: each field replaces the same field of the call's input before it is passed on.",
  },
  delay: {
    label: 'wait (ms)',
    placeholder: '1000',
    hint: "From 0 to 15000. A wait longer than the hook's budget shows what happens when it runs out.",
  },
}

const SCOPES = [
  ['lab', "the lab's own calls"],
  ['others', "other plugins' calls"],
  ['all', "every plugin's calls"],
]

export function interceptForm(state, event) {
  const result = el('div', { class: 'result' })
  const select = (name, options) =>
    el(
      'select',
      { id: `intercept-${name}`, name },
      options.map(([value, label]) => el('option', { value }, label)),
    )
  // The words after /mod-lab that set it: what is sent, and what the echo shows.
  const commandOf = form => {
    const data = Object.fromEntries(new FormData(form).entries())
    const value = String(data.behavior) in VALUE_FIELD ? String(data.value ?? '').trim() : ''
    return ['intercept', event, data.behavior, data.scope, value].filter(Boolean).join(' ')
  }
  const echo = echoLine('The same, typed in Claude Code:')
  const valueName = el('span', {})
  const valueInput = el('input', { id: 'intercept-value', name: 'value' })
  const valueHint = el('small', { class: 'muted' })
  // What the stub stands for, in the declarations' own words, read from the person's copy when the form asks.
  const stubDoc = el('div', { class: 'stub-doc', hidden: true })
  // A stub of the declared shape fills the field for answer and rewrite (web/lib/stubs.mjs); a type with several
  // shapes offers each. The event's stubs are asked for once, and only a stub this form filled in is ever replaced.
  let stubs = null
  let filled = ''
  let shownBehavior = ''
  const fill = stub => {
    valueInput.value = stub?.json ?? ''
    filled = valueInput.value
    stubDoc.replaceChildren(...(docText(stub?.doc ?? '', state.typeNames) ?? []))
    stubDoc.hidden = !stub?.doc
  }
  const shape = el('select', {
    id: 'intercept-shape',
    'aria-label': 'shape',
    hidden: true,
    onchange: () => {
      const stub = stubs?.[shownBehavior]?.[Number(shape.value)]
      if (stub !== undefined) fill(stub)
    },
  })
  const valueLabel = el('label', { for: 'intercept-value' }, valueName, valueInput, shape, valueHint, stubDoc)
  const offerStubs = async (form, behavior) => {
    stubs ??= await api(`/api/stubs?event=${encodeURIComponent(event)}`).catch(() => ({
      answer: [],
      rewrite: [],
      more: {},
    }))
    if (shownBehavior !== behavior) return
    const list = stubs[behavior] ?? []
    const more = stubs.more?.[behavior] ?? 0
    shape.replaceChildren(
      ...list.map((stub, index) => el('option', { value: String(index) }, `shape: ${stub.label}`)),
      more > 0 ? el('option', { disabled: true }, `and ${more} more in the declaration`) : null,
    )
    shape.hidden = list.length < 2
    if (valueInput.value.trim() === '' || valueInput.value === filled) fill(list[0] ?? null)
    echo.code.textContent = `/mod-lab ${commandOf(form)}`
  }
  const update = form => {
    const behavior = String(new FormData(form).get('behavior'))
    if (behavior !== shownBehavior) {
      shownBehavior = behavior
      if (behavior === 'answer' || behavior === 'rewrite') void offerStubs(form, behavior)
      else {
        shape.hidden = true
        if (valueInput.value === filled) fill(null)
      }
    }
    const field = VALUE_FIELD[behavior]
    valueLabel.hidden = field === undefined
    if (field !== undefined) {
      valueName.textContent = field.label
      valueInput.placeholder = field.placeholder
      valueHint.textContent = field.hint
    }
    echo.code.textContent = `/mod-lab ${commandOf(form)}`
  }
  const form = el(
    'form',
    {
      class: 'probe intercept',
      onsubmit: event_ => {
        event_.preventDefault()
        void sendCommand(state, commandOf(event_.currentTarget), result)
      },
      oninput: event_ => update(event_.currentTarget),
      onchange: event_ => update(event_.currentTarget),
    },
    el('div', { class: 'probe-head' }, el('span', { class: 'probe-label' }, 'Intercept'), el('strong', {}, event)),
    el(
      'p',
      {},
      `The lab's own hook on ${event} does this with each call it covers. The calls it acts on are listed above, and in the Session area's Intercepted tab.`,
    ),
    el(
      'div',
      { class: 'fields' },
      el('label', { for: 'intercept-behavior' }, el('span', {}, 'behavior'), select('behavior', BEHAVIORS)),
      el('label', { for: 'intercept-scope' }, el('span', {}, 'calls by'), select('scope', SCOPES)),
      valueLabel,
    ),
    echo.line,
    el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Set in the session')),
    result,
  )
  update(form)
  return form
}

// The census: what the taps on each event add up to. The lab has the same
// sums for its pane and /mod-lab intercept census (mods/mod-lab/hooks/census.ts).

function tally(names) {
  const counts = new Map()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].sort(([, a], [, b]) => b - a)
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Math.round(value * 100) / 100
}

function censusOf(taps) {
  return [...new Set(taps.map(tap => tap.event))].map(event => {
    const mine = taps.filter(tap => tap.event === event)
    const links = new Map()
    for (const link of mine.flatMap(tap => tap.chain)) {
      const key = `${link.plugin} (${link.tier})`
      links.set(key, [...(links.get(key) ?? []), link])
    }
    return {
      event,
      calls: mine.length,
      callers: tally(mine.map(tap => tap.origin)),
      answeredBy: tally(mine.map(tap => tap.chain.at(-1)?.plugin ?? `mod-lab intercept (${tap.behavior})`)),
      links: [...links].map(([name, seen]) => ({
        name,
        outcomes: tally(seen.map(link => link.outcome)),
        medianMs: median(seen.map(link => link.ms)),
      })),
    }
  })
}

const counted = pairs => pairs.map(([name, n]) => `${name} ${n}`).join(', ')

export function censusView(taps) {
  const list = censusOf(taps)
  if (list.length === 0) return el('div', { class: 'census' })
  return el(
    'div',
    { class: 'census' },
    el('p', { class: 'census-head' }, 'What the calls add up to'),
    list.map(census =>
      el(
        'div',
        { class: 'census-event' },
        el(
          'p',
          {},
          el('strong', {}, census.event),
          ` ${census.calls} call${census.calls === 1 ? '' : 's'}, made by ${counted(census.callers)}; answered by ${counted(census.answeredBy)}`,
        ),
        census.links.length === 0
          ? null
          : el(
              'table',
              { class: 'facts' },
              el('tr', {}, el('th', {}, 'link beneath the lab'), el('th', {}, 'outcomes'), el('th', {}, 'median')),
              census.links.map(link =>
                el(
                  'tr',
                  {},
                  el('td', {}, link.name),
                  el('td', {}, counted(link.outcomes)),
                  el('td', {}, `${link.medianMs} ms`),
                ),
              ),
            ),
      ),
    ),
  )
}

export function refreshCensus(state) {
  document.querySelector('#feed-body > .census')?.replaceWith(censusView(state.taps))
  document.querySelector('#feed-body > .in-force-list')?.replaceWith(inForceList(state))
}

/** What an intercept did to a call, as a word in the row, and the colour that word takes. */
const DID = {
  watch: ['passed on', 'muted'],
  refuse: ['refused', 'bad'],
  answer: ['answered', 'warn'],
  rewrite: ['rewritten', 'warn'],
  delay: ['delayed', 'warn'],
}

/** A call an intercept acted on: the event and its caller, what the intercept did, the chain; opened, the input and the answer in full. */
export function tapRow(tap) {
  const [outcome, tone] = DID[tap.behavior] ?? [tap.behavior, 'muted']
  return logRow({
    at: tap.at,
    name: tap.event,
    by: tap.origin,
    mark: tap.behavior === 'watch' ? 'ix' : 'ix acted',
    outcome,
    tone,
    chain: tap.chain,
    intercepted: tap.behavior,
    parts: [
      ['Input', payloadView(tap.received)],
      ['Result', payloadView(tap.returned)],
    ],
  })
}

/** What an intercept in force does, as a sentence: "Refuses the lab's own calls." */
function ruleOf(one) {
  const scope = Object.fromEntries(SCOPES)[one.scope]
  const verb = {
    watch: 'Watches',
    refuse: 'Refuses',
    answer: 'Answers with a replacement value for',
    rewrite: 'Overwrites input fields for',
    delay: `Delays by ${one.ms} ms`,
  }[one.behavior]
  return `${verb} ${scope}${one.until ? `, until ${clockTime(one.until)}` : ''}.`
}

function valueButton(one) {
  if (one.behavior !== 'answer' && one.behavior !== 'rewrite') return null
  return el(
    'button',
    {
      type: 'button',
      class: 'quiet',
      'aria-haspopup': 'dialog',
      onclick: () =>
        openDataDialog(
          `${one.event} · ${one.behavior === 'answer' ? 'Replacement value' : 'Input overrides'}`,
          one.value,
        ),
    },
    'View value',
  )
}

/** The intercepts in force, at the top of the Intercepted tab: each with what it does, how many calls it has seen, and Clear. */
export function inForceList(state) {
  const list = state.mirror.intercepts
  if (list.length === 0) return el('div', { class: 'in-force-list' })
  const status = el('div', { class: 'result' })
  return el(
    'div',
    { class: 'in-force-list' },
    el('p', { class: 'census-head' }, 'In force'),
    list.map(one => {
      const seen = state.taps.filter(tap => tap.event === one.event && tap.at >= one.since).length
      return el(
        'div',
        { class: 'force' },
        el('i', { class: `mark ix${one.behavior === 'watch' ? '' : ' acted'}`, 'aria-hidden': 'true' }),
        el('span', { class: 'row-name' }, el('a', { href: `#/$/${one.event}` }, one.event)),
        el(
          'button',
          {
            type: 'button',
            class: 'quiet',
            onclick: () => void sendCommand(state, `intercept clear ${one.event}`, status),
          },
          'Clear',
        ),
        el('span', { class: 'rule' }, ruleOf(one), valueButton(one)),
        el('span', { class: 'tally' }, `${seen} call${seen === 1 ? '' : 's'}`),
      )
    }),
    status,
  )
}

/** The intercept in force on one event, and the calls intercepts acted on there: redrawn in place as they change. */
function fillInterceptState(state, box, event) {
  const one = state.mirror.intercepts.find(intercept => intercept.event === event)
  const status = el('div', { class: 'result' })
  const inForce =
    one === undefined
      ? el('p', { class: 'muted no-intercept' }, 'No intercept on this event.')
      : el(
          'p',
          { class: 'in-force' },
          el('span', { class: 'in-force-text' }, ruleOf(one)),
          ' ',
          valueButton(one),
          el(
            'button',
            {
              type: 'button',
              class: 'quiet',
              onclick: () => void sendCommand(state, `intercept clear ${event}`, status),
            },
            'Clear',
          ),
        )
  const taps = state.taps
    .filter(tap => tap.event === event)
    .slice(-10)
    .reverse()
  const acted = el(
    'div',
    { class: 'acted' },
    el('h4', {}, `Calls acted on (${taps.length})`),
    taps.length === 0 ? el('p', { class: 'muted' }, 'None yet.') : taps.map(tapRow),
  )
  // With nothing in force and nothing acted on, there is no list to show.
  box.replaceChildren(inForce, status, ...(one === undefined && taps.length === 0 ? [] : [acted]))
}

export function interceptState(state, event) {
  const box = el('div', { 'data-intercept-state': event })
  fillInterceptState(state, box, event)
  return box
}

export function refreshInterceptState(state) {
  refreshInterceptStatus(state)
  document.querySelector('#feed-body > .in-force-list')?.replaceWith(inForceList(state))
  for (const box of document.querySelectorAll('[data-intercept-state]'))
    fillInterceptState(state, box, /** @type {HTMLElement} */ (box).dataset.interceptState)
}

/** A persistent top-rail reminder, including intercepts set outside this page. */
export function refreshInterceptStatus(state) {
  const status = document.getElementById('intercept-status')
  if (status === null) return
  const count = state.mirror.intercepts.length
  const connected = Boolean(state.session?.isConnected)
  const signature = JSON.stringify([state.mirror.intercepts, connected, state.taps.length, state.taps.at(-1)?.seq])
  if (status.dataset.signature === signature) return
  status.dataset.signature = signature
  status.hidden = count === 0
  if (count === 0) status.removeAttribute('open')
  document.getElementById('intercept-count').textContent =
    `${count} intercept${count === 1 ? '' : 's'} ${connected ? 'active' : '· last known'}`
  document
    .getElementById('intercept-panel')
    .replaceChildren(
      el(
        'p',
        { class: 'muted' },
        connected
          ? 'These intercepts remain in force as you move between pages.'
          : 'Session disconnected. These were the last reported intercepts; reconnect to verify or clear them.',
      ),
      inForceList(state),
    )
}
