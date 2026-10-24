// DOM helpers for the explorer page. Text always goes in as text nodes:
// what a session reports (file contents, tool output) is never parsed as HTML.

/** `el('div', { class: 'x', onclick }, child, ...)`; children are nodes, strings, arrays or null. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
    else if (key === 'class') node.className = value
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  append(node, children)
  return node
}

/** Puts `children` in place of `node`'s own, flattening arrays and skipping null as el does; replaceChildren alone would draw an array as text. */
export function fill(node, ...children) {
  node.replaceChildren()
  append(node, children)
  return node
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) append(node, child)
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

const IDENTIFIER = /([A-Za-z_$][A-Za-z0-9_$]*)/

/** Code text with each known type name as a link to its declaration. */
export function linkedCode(text, typeNames, tag = 'code') {
  const parts = String(text).split(IDENTIFIER)
  return el(
    tag,
    {},
    parts.map(part => (typeNames.has(part) ? el('a', { href: `#/type/${part}`, class: 'type' }, part) : part)),
  )
}

/**
 * A doc comment as paragraphs: the comments are hard-wrapped, so single line
 * breaks join, blank lines separate, and `backticks` become code.
 */
export function docText(text, typeNames) {
  if (!text) return null
  return text.split(/\n\s*\n/).map(paragraph =>
    el(
      'p',
      {},
      paragraph
        .replace(/\s*\n\s*/g, ' ')
        .split(/(`[^`]+`)/)
        .map(piece =>
          piece.startsWith('`') && piece.endsWith('`') && piece.length > 1
            ? linkedCode(piece.slice(1, -1), typeNames)
            : piece,
        ),
    ),
  )
}

const INLINE_CHARS = 60
const FOLD_ENTRIES = 12

function jsonLeaf(value) {
  if (typeof value === 'string' && value.includes('\n')) return el('pre', { class: 'json-text' }, value)
  const kind = value === null ? 'null' : typeof value
  return el('span', { class: `json-${kind}` }, kind === 'string' ? value : JSON.stringify(value))
}

/**
 * A value as a reader of it wants it: a leaf on its own, coloured by its type and
 * a string without its quotes; an object or array as a list of its fields, each
 * key dim before its value, nested ones under a guide line. A nested value that
 * is short stays on its key's line; one with many entries is folded under a
 * summary that says how many, and opens on request. File contents and command
 * output keep their line breaks.
 */
export function jsonTree(value, depth = 0, expanded = false) {
  if (value === null || typeof value !== 'object') return jsonLeaf(value)
  const isList = Array.isArray(value)
  const entries = isList ? value.map((item, index) => [index, item]) : Object.entries(value)
  if (entries.length === 0) return emptyJson(isList)
  const text = JSON.stringify(value)
  if (depth > 0 && text.length <= INLINE_CHARS) return inlineJson(text, isList)
  const rows = jsonRows(entries, isList, depth, expanded)
  return depth === 0 ? rows : nestedJson(rows, entries.length, isList, expanded)
}

function emptyJson(isList) {
  return el('span', { class: 'json-empty' }, isList ? 'empty list' : 'empty object')
}

function inlineJson(text, isList) {
  return el('span', { class: 'json-inline' }, isList ? text : text.slice(1, -1).replace(/"(\w+)":/g, '$1: '))
}

function jsonRows(entries, isList, depth, expanded) {
  return el(
    'div',
    { class: `json-rows${isList ? ' list' : ''}` },
    entries.map(([key, item]) =>
      el(
        'div',
        { class: 'json-row' },
        el('span', { class: 'json-key' }, String(key)),
        jsonTree(item, depth + 1, expanded),
      ),
    ),
  )
}

function nestedJson(rows, length, isList, expanded) {
  const noun = isList ? 'item' : 'field'
  const count = `${length} ${noun}${length === 1 ? '' : 's'}`
  if (!expanded && length > FOLD_ENTRIES) return el('details', { class: 'json' }, el('summary', {}, count), rows)
  return el('div', { class: 'json-nested' }, el('span', { class: 'json-count' }, count), rows)
}

const TEXT_FIELDS = new Set(['text', 'content', 'thinking', 'answer', 'stdout', 'stderr', 'output', 'prompt'])
const CONTENT_FIELDS = new Set(['message', 'messages', 'chunks', 'value'])
const BLOCK_LABELS = {
  text: 'Text',
  thinking: 'Thinking',
  tool_use: 'Tool call',
  tool_result: 'Tool result',
  image: 'Image',
}
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1)

function itemLabel(item, index, parent) {
  const entry = item ?? {}
  const role = entry.role ?? entry.message?.role
  if (typeof role === 'string') return `Message ${index + 1} · ${capitalize(role)}`
  const kind = BLOCK_LABELS[entry.type] ?? entry.type
  const detail = [kind, entry.name].filter(value => typeof value === 'string').join(': ')
  return `${parent} ${index + 1}${detail === '' ? '' : ` · ${detail}`}`
}

function fieldLabel(key, value, parent) {
  if (typeof value.stream === 'string') return `${parent} · ${value.stream}`
  if (key === 'text' || key === 'content' || key === 'value' || key === 'message') return parent
  return parent === 'Content' ? capitalize(key) : `${parent} · ${capitalize(key)}`
}

function objectPieces(value, label) {
  const context = typeof value.role === 'string' && label === 'Content' ? `${capitalize(value.role)} message` : label
  const pieces = Object.entries(value).flatMap(([key, child]) => {
    if (TEXT_FIELDS.has(key) || CONTENT_FIELDS.has(key))
      return readablePieces(child, fieldLabel(key, value, context), true)
    if (key === 'tools' && Array.isArray(child) && child.length > 0)
      return [{ label: `${context} · Tools`, data: child }]
    return []
  })
  return pieces
}

/** Keep every item of a content array, including tool calls and other non-text blocks. */
function readablePieces(value, label = 'Content', preserve = false) {
  if (typeof value === 'string') return [{ label, text: value }]
  if (Array.isArray(value))
    return value.flatMap((item, index) => readablePieces(item, itemLabel(item, index, label), true))
  const pieces = value !== null && typeof value === 'object' ? objectPieces(value, label) : []
  return pieces.length > 0 || !preserve ? pieces : [{ label, data: value }]
}

function readableText(value) {
  if (value === '') return el('p', { class: 'detail-empty muted' }, 'No text content.')
  return el(
    'div',
    {},
    el('pre', { class: 'detail-text' }, value),
    /\.\.\. \(\d+ more characters\)\s*$/.test(value)
      ? el(
          'p',
          { class: 'capture-note muted' },
          'Truncated during capture. The remaining text is not available in this log.',
        )
      : null,
  )
}

/** Full readable output, with structured diagnostics kept separate from the content. */
export function payloadView(value) {
  if (typeof value === 'string') return readableText(value)
  const pieces = readablePieces(value)
  if (pieces.length === 0) return jsonTree(value, 0, true)
  return el(
    'div',
    { class: 'payload' },
    pieces.map(piece =>
      el(
        'div',
        { class: 'payload-block' },
        el('p', { class: 'payload-label' }, piece.label),
        'text' in piece ? readableText(piece.text) : jsonTree(piece.data, 0, true),
      ),
    ),
    el('details', { class: 'detail-secondary' }, el('summary', {}, 'Raw data'), jsonTree(value, 0, true)),
  )
}

/** What a chain's link did, as a cell of the strip and a word in the table: the outcome's class, and what it means. */
const LINK_MEANING = {
  returned: 'Returned a result',
  passed: 'Called the next hook',
  kept: 'Unchanged',
  caught: 'Handled an error',
  rejected: 'Rejected',
  skipped: 'Skipped',
  expired: 'Timed out',
}

/**
 * The chain a call went down, as a strip of cells: the caller, then a cell a
 * link, filled where it answered, red where it rejected, dashed where it was
 * skipped or ran out of time; a ring first where an intercept stood in front,
 * filled where the intercept acted. The time is the links' together.
 */
export function chainStrip(links, intercepted = undefined) {
  const cells = [el('i', { class: 'from', title: 'the caller' })]
  if (intercepted !== undefined)
    cells.push(
      el('i', { class: 'w' }),
      el('i', {
        class: `k ix${intercepted === 'watch' ? '' : ' acted'}`,
        title: `the lab's intercept: ${intercepted}`,
      }),
    )
  for (const link of links)
    cells.push(
      el('i', { class: 'w' }),
      el('i', {
        class: `k ${link.outcome}`,
        title: `${link.plugin} (${link.tier} tier) ${LINK_MEANING[link.outcome] ?? link.outcome}, ${link.ms} ms`,
      }),
    )
  const ms = links.reduce((sum, link) => sum + link.ms, 0)
  const words = [
    intercepted === undefined ? null : `the lab's intercept ${intercepted}`,
    ...links.map(link => `${link.plugin} ${link.outcome}`),
  ]
  return el(
    'span',
    {
      class: 'strip',
      role: 'img',
      'aria-label': `chain: ${words.filter(Boolean).join(', ') || 'nothing beneath the lab'}`,
    },
    cells,
    links.length === 0 ? null : el('span', { class: 'ms' }, `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`),
  )
}

/** The chain as a table, one link a row: its cell, the plugin, its tier, what it did, its time, and what it received where a hook above rewrote that. */
export function chainTable(links, intercepted = undefined) {
  const row = (cell, who, tier, did, ms, received) =>
    el(
      'tr',
      {},
      el('td', {}, cell),
      el('td', { class: 'who', 'data-label': 'Plugin' }, who),
      el('td', { class: 'tier', 'data-label': 'Scope' }, tier),
      el('td', { 'data-label': 'Outcome' }, did),
      el('td', { class: 'num', 'data-label': 'Duration' }, ms),
      el('td', { class: 'received', 'data-label': 'Modified input' }, received),
    )
  const rows = []
  if (intercepted !== undefined)
    rows.push(
      row(
        el('i', { class: `k ix${intercepted === 'watch' ? '' : ' acted'}` }),
        'mod-lab',
        'intercept',
        intercepted,
        '',
        '',
      ),
    )
  for (const link of links)
    rows.push(
      row(
        el('i', { class: `k ${link.outcome}` }),
        link.plugin,
        `${link.tier} tier`,
        `${LINK_MEANING[link.outcome] ?? link.outcome}${link.chunks === undefined ? '' : `, ${link.chunks} chunks`}`,
        `${link.ms} ms`,
        link.received === undefined ? '—' : payloadView(link.received),
      ),
    )
  if (rows.length === 0)
    return el('p', { class: 'muted' }, 'No downstream hooks ran. The intercept returned the result directly.')
  return el(
    'table',
    { class: 'links' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ['', 'Plugin', 'Scope', 'Outcome', 'Duration', 'Modified input'].map(label =>
          el('th', { scope: 'col' }, label),
        ),
      ),
    ),
    el('tbody', {}, rows),
  )
}

let detailSequence = 0

/**
 * An entry of a log, in two lines that always fit: a mark whose shape is the
 * outcome, the event and who called it, the outcome word and the time; then
 * the chain as a strip. The full input, answer and chain open in a dialog, so
 * nothing is cut short in the row. The element is a disclosure, so the page
 * and its checks know it as details.trace; opening it shows the dialog.
 */
export function logRow(options) {
  const { at, name, href, by, mark, outcome, tone, chain, intercepted, what, note, src, chainTitle, parts } =
    logOptions(options)
  const title = [name, by === null ? null : `from ${by}`].filter(Boolean).join(' ')
  const titleId = `log-detail-${++detailSequence}`
  const dialog = el(
    'dialog',
    { class: 'detail', 'aria-labelledby': titleId },
    logHeader({ at, name, href, by, mark, outcome, tone, titleId }, () => dialog.close()),
    el(
      'div',
      { class: 'detail-body' },
      typeof what === 'string' ? el('p', { class: 'detail-summary' }, what) : null,
      parts.map(([label, node]) => el('section', {}, el('h3', {}, label), node)),
      chainTitle === null ? null : el('section', {}, el('h3', {}, chainTitle), chainTable(chain, intercepted)),
    ),
  )
  dialog.addEventListener('click', event => {
    if (event.target.closest?.('a[href^="#/"]')) {
      dialog.close()
      return
    }
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close()
  })
  const row = el(
    'details',
    { class: 'trace' },
    el(
      'summary',
      { title: `${title}: open the details` },
      el('i', { class: `mark ${mark}`, 'aria-hidden': 'true' }),
      el(
        'span',
        { class: 'row-name' },
        href === null ? name : el('a', { href, onclick: event => event.stopPropagation() }, name),
        by === null ? null : el('span', { class: 'row-by' }, ` from ${by}`),
      ),
      outcome === null ? null : el('span', { class: `row-outcome ${tone}` }, outcome),
      el('span', { class: 'time' }, clockTime(at)),
      what === null ? null : el('span', { class: 'row-what' }, what),
      el(
        'span',
        { class: 'line2' },
        chainStrip(chain, intercepted),
        note === null ? null : el('span', { class: 'more' }, note),
        src === null ? null : el('span', { class: 'src' }, src),
        el('span', { class: 'log-open-label', 'aria-hidden': 'true' }, 'Details'),
      ),
    ),
    dialog,
  )
  row.addEventListener('toggle', () => {
    if (row.open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector('h2').focus()
    }
  })
  dialog.addEventListener('close', () => {
    row.open = false
  })
  return row
}

const LOG_DEFAULTS = {
  href: null,
  by: null,
  mark: 'dot',
  outcome: null,
  tone: 'muted',
  chain: [],
  intercepted: undefined,
  what: null,
  note: null,
  src: null,
  chainTitle: 'Hook chain',
}

function logOptions(options) {
  const defined = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  return { ...LOG_DEFAULTS, at: options.at, name: options.name, parts: options.parts, ...defined }
}

function logHeader({ at, name, href, by, mark, outcome, tone, titleId }, close) {
  return el(
    'header',
    {},
    el('i', { class: `mark ${mark}` }),
    el(
      'h2',
      { class: 'detail-title', id: titleId, tabindex: '-1' },
      href === null ? name : el('a', { href, onclick: close }, name),
      by === null ? null : el('span', { class: 'row-by' }, ` from ${by}`),
    ),
    outcome === null ? null : el('span', { class: `row-outcome ${tone}` }, outcome),
    el('span', { class: 'time' }, clockTime(at)),
    el('button', { type: 'button', class: 'quiet close', 'aria-label': 'Close details', onclick: close }, 'Close'),
  )
}

export function clockTime(at) {
  return new Date(at).toLocaleTimeString([], { hour12: false })
}

export function compact(value, chars = 90) {
  const text = JSON.stringify(value) ?? 'null'
  return text.length > chars ? `${text.slice(0, chars)}...` : text
}
