// The Prompt box page: the session's prompt box as the lab's prompt.edit and
// prompt.change hooks see it. A ribbon of the newest keys, a walkthrough that
// ticks itself off, the log with the picked row explained, and mods to build
// from it. Typing happens in the session; the lab keeps no text.

import { pageHead } from './areas.js'
import { componentControl, forgetComponents } from './components.js'
import { capOf, explain, hookLines, kindOf, notesOf, runsOf, shortOf, summaryOf, TRIES } from './keys-rows.js'
import { helpButton } from './page.js'
import { sessionVersion } from './versions.js'
import { clockTime, el } from './view.js'

// Rows the ribbon draws, the newest last.
const RIBBON_ROWS = 48

// The state the page last drew, for a pick to draw again from.
let current = null
// The row picked in the log, by seq; null follows the newest.
let picked = null
// The newest row drawn, so the keycaps that arrive after it pop in.
let drawnSeq = null
// The tries done in each session, kept once their row has left the lab's hundred.
const tried = new Map()

const IDEAS = [
  {
    title: 'Keycast',
    pitch:
      'The ribbon above as a mod: each key drawn above the prompt as you press it, for screen recordings. Running in your session, it can show the characters too.',
    uses: ['prompt.edit', 'ui.render'],
    component: 'keycast-mod',
  },
  {
    title: 'Close brackets',
    pitch: 'Typing ( puts in () with the cursor between, and the bracket beside the cursor lights up its partner.',
    uses: ['prompt.edit'],
    component: 'brackets-mod',
  },
  {
    title: 'Shortcodes',
    pitch:
      'Claude Code turns :tada: into 🎉 already. These are your own: type :tests: and the closing colon writes the prompt it stands for.',
    uses: ['prompt.edit'],
    component: 'shortcodes-mod',
  },
  {
    title: 'Paint commands',
    pitch:
      'A slash command drawn bold as it is typed, one that does not exist underlined, and the rest of a partial one shown as ghost text.',
    uses: ['prompt.edit'],
    more: ['the same for /mod-lab, step by step', '#/learn/typeahead'],
    component: 'paint-mod',
  },
  {
    title: 'Catch a pasted key',
    pitch:
      'Anything shaped like an API key painted red the moment it is pasted, and the prompt held back once before it can be sent.',
    uses: ['prompt.edit', 'prompt.submit'],
    more: ['the redact challenge', '#/learn/redact'],
    component: 'paste-guard-mod',
  },
  {
    title: 'Bring back a cleared draft',
    pitch: 'The draft Ctrl+C threw away, offered back as a suggestion Tab takes.',
    uses: ['prompt.edit', 'prompt.change', 'prompt.suggest'],
    component: 'draft-keeper-mod',
  },
]

const hrefOf = name => (name === 'prompt.fill' || name === 'prompt.suggest' ? `#/$/${name}` : `#/event/${name}`)

function whereLine(state) {
  const session = state.session
  if (session?.isConnected !== true) {
    return el(
      'p',
      { class: 'hint' },
      'No session is connected. In your project directory, ',
      el('code', {}, 'npx claude-mod-lab run'),
      ' starts Claude Code with the lab, connected to this page.',
    )
  }
  return el(
    'p',
    { class: 'muted' },
    `Watching session ${String(session.facts.id ?? '').slice(0, 8)}. The lab, the mod-lab mod in it, passes every edit on untouched and sends this page the key and the lengths, never the text. `,
    el('code', {}, '/mod-lab keys'),
    ' shows the same in the terminal.',
  )
}

function emptyRibbon(state) {
  return el(
    'span',
    { class: 'ribbon-empty' },
    state.session?.isConnected === true
      ? "Type in the session's prompt box: each key shows up here as you press it."
      : 'The keys you press will show up here.',
  )
}

function keycap(run) {
  const newest = run.rows.at(-1)
  const isMarked = run.rows.some(row => row.isRewritten || row.decorations > 0)
  const isFresh = drawnSeq !== null && newest.seq > drawnSeq
  return el(
    'button',
    {
      type: 'button',
      class: `keycap ${run.group}${isFresh ? ' fresh' : ''}${isMarked ? ' marked' : ''}${newest.seq === picked ? ' picked' : ''}`,
      title: explain(newest),
      onclick: () => pick(newest.seq),
    },
    run.cap,
    run.rows.length > 1 ? el('span', { class: 'times' }, `×${run.rows.length}`) : null,
  )
}

function summaryLine(rows) {
  const { edits, changes, rewritten, painted, box } = summaryOf(rows)
  if (box === null) return ''
  const marks = [
    rewritten > 0 ? `${rewritten} rewritten beneath the lab` : null,
    painted > 0 ? `${painted} painted` : null,
  ].filter(Boolean)
  return `${edits} edit${edits === 1 ? '' : 's'} and ${changes} change${changes === 1 ? '' : 's'} in the log · the box: ${box.length} characters, cursor at ${box.cursor}${marks.length === 0 ? '' : ` · ${marks.join(', ')}`}`
}

function promptForm(kind, queueRun, status) {
  const isFill = kind === 'fill'
  return el(
    'form',
    {
      class: 'inline-form',
      onsubmit: event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const text = String(data.get('text') ?? '')
        void queueRun(
          isFill ? 'prompt.fill' : 'prompt.suggest',
          isFill ? { text, mode: String(data.get('mode')) } : { text },
          status,
        )
      },
    },
    el('input', {
      name: 'text',
      placeholder: isFill ? 'Text for the prompt box' : 'A prompt to suggest',
      'aria-label': isFill ? 'Text to fill' : 'Text to suggest',
    }),
    isFill
      ? el(
          'select',
          { name: 'mode', 'aria-label': 'Where the text goes' },
          ...['append', 'replace', 'insert'].map(mode => el('option', { value: mode }, mode)),
        )
      : null,
    el('button', { type: 'submit' }, isFill ? 'Fill' : 'Suggest'),
  )
}

function triesList(queueRun) {
  return el(
    'ol',
    { class: 'tries' },
    ...TRIES.map(one => {
      const status = el('div', { class: 'result' })
      return el(
        'li',
        { 'data-try': one.id },
        el('span', { class: 'try-check', 'aria-hidden': 'true' }),
        el(
          'div',
          {},
          el('strong', {}, one.label),
          el('div', { class: 'muted' }, one.hint),
          one.form === undefined ? null : [promptForm(one.form, queueRun, status), status],
        ),
      )
    }),
  )
}

function triedNow(state, rows) {
  const key = state.session?.facts?.id ?? ''
  const done = tried.get(key) ?? new Set()
  for (const one of TRIES) if (!done.has(one.id) && rows.some(one.test)) done.add(one.id)
  tried.set(key, done)
  return done
}

function logList(rows) {
  if (rows.length === 0) return el('p', { class: 'muted' }, 'No edit yet.')
  const shown = picked ?? rows.at(-1).seq
  return el(
    'table',
    { class: 'keys-table' },
    el('thead', {}, el('tr', {}, ...['', '#', 'key', 'what', 'box', ''].map(label => el('th', {}, label)))),
    el(
      'tbody',
      {},
      ...[...rows].reverse().map(row =>
        el(
          'tr',
          {
            class: row.seq === shown ? 'picked' : '',
            tabindex: '0',
            'data-seq': row.seq,
            onclick: () => pick(row.seq),
            onkeydown: event => stepPick(event, row.seq),
          },
          el('td', { class: 'marker' }, row.seq === shown ? '▸' : ''),
          el('td', { class: 'muted', title: clockTime(row.at) }, `${row.seq}`),
          el(
            'td',
            {},
            el('span', { class: `keycap small ${row.kind === 'change' ? 'change' : kindOf(row)}` }, capOf(row)),
          ),
          el('td', {}, shortOf(row)),
          el('td', {}, row.before === null ? `→ ${row.after}` : `${row.before} → ${row.after}`),
          el(
            'td',
            { class: 'marks' },
            row.isRewritten
              ? el('span', { class: 'rewritten', title: 'a hook beneath the lab changed what landed' }, 'rewritten')
              : null,
            row.decorations > 0
              ? el(
                  'span',
                  { class: 'painted', title: 'runs painted by hooks beneath the lab' },
                  `painted ${row.decorations}`,
                )
              : null,
          ),
        ),
      ),
    ),
  )
}

/** Up and down move the pick through the list, as the arrow keys would in a list box. */
function stepPick(event, seq) {
  const rows = current.mirror.keys.rows
  const step = { ArrowDown: -1, ArrowUp: 1, Enter: 0, ' ': 0 }[event.key]
  const next = rows[rows.findIndex(row => row.seq === seq) + (step ?? 0)]
  if (step === undefined || next === undefined) return
  event.preventDefault()
  pick(next.seq)
  // The list was drawn again: the focus goes to the picked row's new element.
  /** @type {HTMLElement | null} */
  const row = document.querySelector(`.keys-table tr[data-seq="${next.seq}"]`)
  row?.focus()
}

const percent = (count, scale) => `${((100 * count) / scale).toFixed(2)}%`

function bar(label, segments, scale, cursor, count) {
  return el(
    'div',
    { class: 'shape-row' },
    el('span', { class: 'shape-label' }, label),
    el(
      'div',
      { class: 'shape-track' },
      ...segments
        .filter(([from, to]) => to > from)
        .map(([from, to, kind]) =>
          el('span', {
            class: `seg ${kind}`,
            style: `left: ${percent(from, scale)}; width: ${percent(to - from, scale)}`,
          }),
        ),
      cursor === null ? null : el('span', { class: 'caret', style: `left: ${percent(cursor, scale)}` }),
    ),
    el('span', { class: 'shape-count' }, count),
  )
}

/** The edit's shape without its text: the draft before with the span cut out, and the box after with what went in. */
function shape(row) {
  if (row.kind === 'change')
    return el(
      'div',
      { class: 'shape' },
      bar('now', [[0, row.after, 'kept']], Math.max(row.after, 1), row.cursor, `${row.after}`),
    )
  const { start, end, inserted } = row.splice
  const scale = Math.max(row.before, row.after, 1)
  const after = row.isRewritten
    ? [[0, row.after, 'rewritten']]
    : [
        [0, start, 'kept'],
        [start, start + inserted, 'put'],
        [start + inserted, row.after, 'kept'],
      ]
  const legend = [
    end > start ? ['cut', 'taken out'] : null,
    inserted > 0 && !row.isRewritten ? ['put', 'put in'] : null,
    row.isRewritten ? ['rewritten', 'answered beneath the lab'] : null,
    ['caret', 'cursor'],
  ].filter(Boolean)
  return el(
    'div',
    { class: 'shape' },
    bar(
      'before',
      [
        [0, start, 'kept'],
        [start, end, 'cut'],
        [end, row.before, 'kept'],
      ],
      scale,
      null,
      `${row.before}`,
    ),
    bar('after', after, scale, row.cursor, `${row.after}`),
    el(
      'div',
      { class: 'shape-legend' },
      ...legend.map(([kind, label]) => el('span', {}, el('i', { class: kind }), label)),
    ),
  )
}

function detail(rows) {
  if (rows.length === 0)
    return el('p', { class: 'muted' }, 'The newest edit is explained here, or the one you pick in the list.')
  const row = rows.find(one => one.seq === picked) ?? rows.at(-1)
  return el(
    'div',
    {},
    el(
      'header',
      {},
      el('strong', {}, `#${row.seq}`),
      el('span', { class: 'muted' }, clockTime(row.at)),
      el('span', { class: `keycap small ${row.kind === 'change' ? 'change' : kindOf(row)}` }, capOf(row)),
      el('span', { class: 'muted' }, row.kind === 'change' ? 'prompt.change' : 'prompt.edit'),
      picked === null
        ? el('span', { class: 'following' }, 'following the newest')
        : el('button', { type: 'button', class: 'quiet', onclick: () => pick(null) }, 'Follow the newest'),
    ),
    el('p', { class: 'explained' }, explain(row)),
    shape(row),
    ...notesOf(row).map(note => el('p', { class: note.tone }, note.text)),
    el('pre', { class: 'hook' }, hookLines(row)),
  )
}

function pick(seq) {
  picked = seq
  refreshKeys(current)
  if (seq !== null) document.querySelector('.keys-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

/** Redraws the live parts in place, leaving the forms as typed. */
export function refreshKeys(state) {
  const ribbon = document.querySelector('[data-live="ribbon"]')
  if (ribbon === null) return
  current = state
  const rows = state.mirror.keys.rows
  if (picked !== null && !rows.some(row => row.seq === picked)) picked = null
  const runs = runsOf(rows.slice(-RIBBON_ROWS))
  ribbon.replaceChildren(...(runs.length === 0 ? [emptyRibbon(state)] : runs.map(keycap)))
  drawnSeq = rows.at(-1)?.seq ?? 0
  document.querySelector('[data-live="summary"]').textContent = summaryLine(rows)
  const done = triedNow(state, rows)
  for (const item of document.querySelectorAll('ol.tries > li'))
    item.classList.toggle('done', done.has(/** @type {HTMLElement} */ (item).dataset.try))
  document.querySelector('[data-live="progress"]').textContent =
    done.size === TRIES.length ? 'all done: every way the box changes' : `${done.size} of ${TRIES.length}`
  document.querySelector('[data-live="keys"]').replaceChildren(logList(rows))
  document.querySelector('[data-live="detail"]').replaceChildren(detail(rows))
}

/** `ctx`: the page's `state` and `queueRun(probe, args, target)`. */
export function keysPage(ctx) {
  const { state, queueRun } = ctx
  forgetComponents()
  picked = null
  drawnSeq = null
  queueMicrotask(() => refreshKeys(state))
  return el(
    'div',
    { class: 'page keys-page' },
    pageHead('Prompt box', boxHelp()),
    el(
      'p',
      { class: 'lede' },
      "Every key you press in Claude Code's prompt box is an event a mod sees, and most of them it can change. Type in the session's prompt box and watch each one arrive.",
    ),
    whereLine(state),
    el(
      'section',
      { class: 'keys-live panel' },
      el('div', { class: 'ribbon', 'data-live': 'ribbon', 'aria-live': 'polite' }),
      el('p', { class: 'muted', 'data-live': 'summary' }),
    ),
    el('h2', {}, 'The log'),
    el(
      'p',
      { class: 'muted' },
      'The newest hundred edits and changes, newest first. Pick one, or a key in the ribbon, to see it explained with the hook that would see it.',
    ),
    el(
      'div',
      { class: 'keys-log panel' },
      el('div', { class: 'keys-list', 'data-live': 'keys' }),
      el('div', { class: 'keys-detail', 'data-live': 'detail' }),
    ),
    el(
      'details',
      { class: 'notes' },
      el('summary', {}, 'Try these ', el('span', { class: 'progress', 'data-live': 'progress' })),
      triesList(queueRun),
    ),
    el('h2', {}, 'Build on it'),
    el(
      'p',
      {},
      'Each of these is a small mod. Add one to the session and try it: it runs beneath the lab, so its rewrites and paint show in the log above. Add copies it into ',
      el('code', {}, '.claude/skills/'),
      ', where your copy is yours to change, and each session started in this folder loads it until you remove it.',
    ),
    el(
      'div',
      { class: 'cards' },
      ...IDEAS.map(idea =>
        el(
          'article',
          { class: 'card' },
          el('h3', {}, idea.title),
          el('p', {}, idea.pitch),
          el(
            'p',
            { class: 'uses' },
            ...idea.uses.map(name => el('a', { href: hrefOf(name) }, el('code', {}, name))),
            idea.more === undefined ? null : el('a', { href: idea.more[1], class: 'more' }, `${idea.more[0]} →`),
          ),
          idea.component === undefined ? null : componentControl(idea.component, sessionVersion(state.session)),
        ),
      ),
    ),
  )
}

function boxHelp() {
  return helpButton(
    'How the box works',
    el(
      'dl',
      { class: 'pairs' },
      el('dt', {}, el('a', { href: hrefOf('prompt.edit') }, el('code', {}, 'prompt.edit'))),
      el(
        'dd',
        {},
        'Each edit, before it lands: the draft, where the editor cuts it and what it puts in. A hook can put in something else, answer another box, paint over it, or consume the key.',
      ),
      el('dt', {}, el('a', { href: hrefOf('prompt.change') }, el('code', {}, 'prompt.change'))),
      el(
        'dd',
        {},
        "Each change that is not an edit: a recalled prompt, a clear, an undo, a mod's fill, a suggestion taken. It has already happened, so a hook can only watch.",
      ),
      el('dt', {}, el('a', { href: hrefOf('prompt.autocomplete') }, el('code', {}, 'prompt.autocomplete'))),
      el('dd', {}, 'Rows a mod adds under the typeahead. This page does not log it.'),
      el(
        'dt',
        {},
        el('a', { href: hrefOf('prompt.fill') }, el('code', {}, '$.prompt.fill')),
        ', ',
        el('a', { href: hrefOf('prompt.suggest') }, el('code', {}, '$.prompt.suggest')),
      ),
      el('dd', {}, "A mod's two ways to write into the box: text as a draft, or dim text that Tab takes."),
    ),
  )
}
