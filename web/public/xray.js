// The Conversation X-ray: each row the conversation kept, as the lab's hook on
// session.append saw it stored, marked by who reads it, and the compactions.
// A row opens its record from the transcript file, read by the server, in a
// dialog: the record's text in full, and its line in the file.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { compactionSection } from './compaction.js'
import { controls, lede, notes, readings, titledNotes } from './page.js'
import { clockTime, el, jsonTree } from './view.js'
import { recordParts } from './xray-record.js'

const READERS = [
  ['all', 'All audiences'],
  ['model', 'Model only'],
  ['person', 'Person only'],
  ['both', 'Both'],
]

let shown = 'all'

const AUDIENCE = { model: 'Model only', person: 'Person only', both: 'Both' }
const ENTRY_LABELS = {
  'hook-context': 'Hook context',
  'tool-result': 'Tool result',
  prompt: 'Prompt',
  response: 'Response',
  attachment: 'Attachment',
  command: 'Command',
  notice: 'Notice',
  note: 'Note',
  compaction: 'Compaction',
  queue: 'Queue',
}

function countTable(rows, key, title, labels) {
  const tally = new Map()
  for (const row of rows) tally.set(row[key], (tally.get(row[key]) ?? 0) + 1)
  return el(
    'section',
    {},
    el(
      'table',
      { class: 'facts xray-counts', 'aria-label': `Row counts by ${title.toLowerCase()}` },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, title), el('th', { scope: 'col' }, 'Rows'))),
      el(
        'tbody',
        {},
        [...tally].map(([name, count]) =>
          el('tr', {}, el('th', { scope: 'row' }, labels[name] ?? name), el('td', {}, String(count))),
        ),
      ),
    ),
  )
}

function rowSummary(rows) {
  return el(
    'div',
    { class: 'xray-summary' },
    el('p', { class: 'xray-total' }, el('strong', {}, String(rows.length)), ' captured rows'),
    countTable(rows, 'reader', 'Audience', AUDIENCE),
    countTable(rows, 'door', 'Entry route', ENTRY_LABELS),
  )
}

function emptyText(row) {
  if (row.blocks?.length > 0) return `${row.blocks.join(', ')} content; no text preview`
  return 'No text preview'
}

const section = (label, ...nodes) => el('section', {}, el('h3', {}, label), ...nodes)

function recordLocation(found) {
  return el(
    'details',
    { class: 'record-metadata' },
    el('summary', {}, 'Record metadata and raw JSON'),
    el('p', { class: 'record-where' }, `JSONL line ${found.line}`, el('code', {}, found.path)),
    jsonTree(found.record),
  )
}

function unavailableContent(row, message) {
  return [
    section('JSONL record unavailable', el('p', { class: 'muted' }, message)),
    section('Captured preview', el('pre', { class: 'record-text' }, row.preview || emptyText(row))),
  ]
}

function openRecord(row) {
  const opener = document.activeElement
  const body = el(
    'div',
    { class: 'detail-body record-body', 'aria-live': 'polite' },
    section('Content', el('p', { class: 'muted' }, 'Loading saved JSONL record…')),
  )
  const titleId = `record-title-${row.seq}`
  const dialog = el(
    'dialog',
    { class: 'detail record', 'aria-labelledby': titleId },
    el(
      'header',
      {},
      el(
        'div',
        { class: 'detail-heading' },
        el(
          'h2',
          { class: 'detail-title', id: titleId, tabindex: '-1' },
          `${ENTRY_LABELS[row.door] ?? row.door} · row #${row.seq}`,
        ),
        el(
          'p',
          { class: 'detail-subtitle' },
          `${row.origin} · ${AUDIENCE[row.reader] ?? row.reader} · ${clockTime(row.at)}`,
        ),
      ),
      el(
        'button',
        { type: 'button', class: 'quiet close', 'aria-label': 'Close content', onclick: () => dialog.close() },
        'Close ×',
      ),
    ),
    body,
  )
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
      dialog.close()
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    else {
      const replacement = document.querySelector(`.xray-row[data-row-seq="${row.seq}"] button`)
      if (replacement instanceof HTMLElement) replacement.focus({ preventScroll: true })
    }
  })
  document.body.append(dialog)
  dialog.showModal()
  dialog.querySelector('h2').focus({ preventScroll: true })
  if (typeof row.uuid !== 'string') {
    body.replaceChildren(
      ...unavailableContent(row, 'This captured row has no saved-record ID. Only its preview is available.'),
    )
    return
  }
  void api(`/api/transcript?uuid=${encodeURIComponent(row.uuid)}`)
    .then(found =>
      body.replaceChildren(...recordParts(found.record), section('Technical details', recordLocation(found))),
    )
    .catch(error => {
      const reason = String(error.message ?? error)
      const message =
        reason === 'not found'
          ? 'This server does not support transcript lookup. Restart the explorer server to load the update. If the session started the server, restart that session.'
          : /no record with this id/.test(reason)
            ? 'No matching JSONL record was found. Some append events have no saved record.'
            : reason
      body.replaceChildren(...unavailableContent(row, message))
    })
}

function contentCell(row) {
  return el(
    'td',
    { class: 'xray-content', 'data-label': 'Content' },
    el(
      'button',
      {
        type: 'button',
        class: 'xray-content-open',
        'aria-label': `View content for row ${row.seq}`,
        onclick: event => {
          event.stopPropagation()
          openRecord(row)
        },
      },
      el('span', { class: 'xray-preview' }, row.preview || emptyText(row)),
      el(
        'span',
        { class: 'xray-open-label' },
        typeof row.uuid === 'string' ? 'View full content ↗' : 'View captured details ↗',
      ),
    ),
    el(
      'span',
      { class: 'xray-content-meta' },
      `${row.chars.toLocaleString()} characters`,
      row.isRewritten ? el('span', { class: 'rewritten' }, ' · Modified by a hook') : null,
    ),
  )
}

function conversationRow(row) {
  return el(
    'tr',
    {
      class: `reader-${row.reader} xray-row`,
      'data-row-seq': row.seq,
      onclick: event => {
        if (event.target.closest('button, a, input, select') || window.getSelection()?.toString()) return
        event.currentTarget.querySelector('button')?.focus({ preventScroll: true })
        openRecord(row)
      },
    },
    el(
      'th',
      { scope: 'row', class: 'xray-row-id', 'data-label': 'Row' },
      el('span', {}, `#${row.seq}`),
      el('span', { class: 'xray-row-meta' }, clockTime(row.at)),
    ),
    el(
      'td',
      { class: 'xray-source', 'data-label': 'Source' },
      el('span', { class: 'xray-source-kind' }, ENTRY_LABELS[row.door] ?? row.door),
      el('span', { class: 'xray-row-meta' }, row.origin),
      el('span', { class: 'xray-row-meta' }, [row.type, row.name].filter(Boolean).join(' · ')),
    ),
    el(
      'td',
      { class: 'xray-audience', 'data-label': 'Audience' },
      el('span', { class: `reader ${row.reader}` }, AUDIENCE[row.reader] ?? row.reader),
    ),
    contentCell(row),
  )
}

function rowsTable(rows) {
  const picked = [...rows].reverse().filter(row => shown === 'all' || row.reader === shown)
  if (picked.length === 0)
    return el(
      'p',
      { class: 'muted' },
      rows.length === 0
        ? 'No rows captured yet. Send a prompt in the connected session.'
        : 'No rows match this audience filter.',
    )
  return el(
    'table',
    { class: 'facts rows xray-rows' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ['Row', 'Source', 'Audience', 'Content'].map(label => el('th', { scope: 'col' }, label)),
      ),
    ),
    el('tbody', {}, picked.map(conversationRow)),
  )
}

/** Redraw the data without disturbing the add-row forms. */
export function refreshXray(state) {
  const live = document.querySelector('[data-live="xray"]')
  if (live === null) return
  const { rows } = state.mirror.rows
  live.replaceChildren(...(rows.length === 0 ? [] : [rowSummary(rows)]), rowsTable(rows))
}

/** `ctx`: the page's `state` and `sendCommand(text, target)`; the compaction section takes the same. */
export function xrayPage(ctx) {
  const { state, sendCommand } = ctx
  const status = el('div', { class: 'result' })
  const adding = (command, label, placeholder) =>
    el(
      'form',
      {
        class: 'inline-form',
        onsubmit: event => {
          event.preventDefault()
          const text = String(new FormData(event.currentTarget).get('text') ?? '').trim()
          if (text !== '') void sendCommand(`${command} ${text}`, status)
        },
      },
      el('input', { name: 'text', placeholder }),
      el('button', { type: 'submit' }, label),
    )
  const filter = el(
    'select',
    {
      onchange: event => {
        shown = event.currentTarget.value
        refreshXray(state)
      },
    },
    ...READERS.map(([value, label]) => el('option', { value, selected: value === shown }, label)),
  )
  const page = el(
    'div',
    { class: 'page xray-page' },
    pageHead('Conversation X-ray'),
    lede(
      'Append events captured since the lab started. Open a row to look up its saved JSONL record. This is not a capture of the full request sent to Claude.',
    ),
    readings(
      'Rows',
      { aside: el('label', { class: 'readings-filter' }, 'Audience ', filter) },
      el('div', { 'data-live': 'xray' }),
    ),
    titledNotes(
      'Add a note or notice',
      controls(
        'Add a row',
        el('p', {}, 'Note: adds context for Claude, hidden from the ordinary chat display.'),
        adding('note', 'Add model note', 'Note for the model'),
        el('p', {}, 'Notice: adds a line to the chat display. The notice row is excluded from model input.'),
        adding('notice', 'Add chat notice', 'Notice for the person'),
        el(
          'p',
          {},
          'Both are saved in the session JSONL when persistence is enabled. Neither starts a model turn. An accepted note is available for a later request; it cannot change a request already in progress.',
        ),
        el(
          'p',
          {},
          'Try adding a note here while Claude is idle, wait for its acknowledgment, then send a normal prompt in Claude Code. Typing the slash command can also expose its text through separate command records.',
        ),
        status,
      ),
    ),
    compactionSection(ctx),
    notes(
      'The chat display, saved JSONL, and model input are different views. Claude receives a request assembled from conversation messages, a system prompt, tools, and context. JSONL is a saved session record, not a complete recording of every request.',
      'This page tracks session.append events while the lab is loaded. A preview may be empty even when its JSONL record contains attachment data or other fields. Open a row for saved content, record metadata, and raw JSON. Some append events have no matching saved record.',
      'Audience is inferred from row metadata; it does not prove inclusion in a particular model request. “Modified by a hook” means this append hook observed a content rewrite before storage. The rewritten content is stored and, if that row is sent to the model, sent too; the chat display may already show the original.',
      'Other hooks act during request assembly: prompt.attachment can change what Claude receives while JSONL keeps the engine’s attachment record. The Context ledger shows the system prompt and tool definitions separately from conversation rows.',
    ),
  )
  queueMicrotask(() => refreshXray(state))
  return page
}
