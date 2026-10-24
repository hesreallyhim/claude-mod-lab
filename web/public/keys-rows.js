// The prompt box log's rows in words: what kind of edit or change each is,
// the keycap that stands for it, a sentence saying what happened, and the
// hook a mod would write to see it. No DOM here, so web/test runs it.

const GLYPHS = {
  space: '␣',
  backspace: '⌫',
  delete: '⌦',
  return: '⏎',
  tab: '⇥',
  escape: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
}
const WORDS = {
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  return: 'Return',
  tab: 'Tab',
  escape: 'Escape',
  pageup: 'Page Up',
  pagedown: 'Page Down',
}
const MODIFIER_GLYPHS = { ctrl: '⌃', meta: '⌥', shift: '⇧' }
const MODIFIER_WORDS = { ctrl: 'Ctrl', meta: 'Meta', shift: 'Shift' }
const CHANGE_KINDS = new Set(['history', 'clear', 'undo', 'engine', 'app'])

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** The lab's name for a key ('ctrl+u', 'shift+tab', 'text') as its modifiers and the key itself. */
export function keyParts(name) {
  const [, prefix, key] = /^((?:(?:ctrl|meta|shift)\+)*)(.+)$/.exec(name)
  return { modifiers: prefix.split('+').filter(Boolean), key }
}

/** The filling plugin's name, from a change row's origin 'plugin <name>'; null for another origin. */
function filler(row) {
  return row.origin.startsWith('plugin ') ? row.origin.slice('plugin '.length) : null
}

/**
 * What a row is: an edit typed, deleted, moved, pasted or typed over a
 * selection, or a change by history, clear, undo, fill, engine or app. An
 * origin this page does not know counts as engine, as the types advise.
 */
export function kindOf(row) {
  if (row.kind === 'change') return filler(row) !== null ? 'fill' : CHANGE_KINDS.has(row.origin) ? row.origin : 'engine'
  if (row.splice === null) return 'type'
  const { start, end, inserted } = row.splice
  if (row.key === null) return 'paste'
  if (inserted === 0) return end === start ? 'move' : 'delete'
  return end > start ? 'replace' : 'type'
}

/** The keycap that stands for a row: a key's glyph with its modifiers, a paste's size, a change's origin. */
export function capOf(row) {
  if (row.kind === 'change') return kindOf(row) === 'fill' ? `fill · ${filler(row)}` : kindOf(row)
  if (row.key === null)
    return row.splice.inserted > 1 ? `paste +${row.splice.inserted}` : row.splice.inserted === 1 ? '+1' : 'burst'
  const { modifiers, key } = keyParts(row.key)
  const face = key === 'text' ? 'typed' : (GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key))
  return modifiers.map(modifier => MODIFIER_GLYPHS[modifier]).join('') + face
}

/** A key in words for a sentence: 'Ctrl+U', 'Backspace', '←'. */
function keyWords(name) {
  const { modifiers, key } = keyParts(name)
  const word = WORDS[key] ?? GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  return [...modifiers.map(modifier => MODIFIER_WORDS[modifier]), word].join('+')
}

/** Consecutive rows with the same keycap, as one keycap with a count: typed ×5. */
export function runsOf(rows) {
  const runs = []
  for (const row of rows) {
    const cap = capOf(row)
    const last = runs.at(-1)
    if (last?.cap === cap) last.rows.push(row)
    else runs.push({ cap, kind: kindOf(row), group: row.kind === 'change' ? 'change' : kindOf(row), rows: [row] })
  }
  return runs
}

/** A short note of what a row did, for the log's list. */
export function shortOf(row) {
  if (row.kind === 'change') return `cursor ${row.cursor}`
  const { start, end, inserted } = row.splice
  const kind = kindOf(row)
  if (kind === 'move') return `cursor to ${row.cursor}`
  if (kind === 'delete') return `−${end - start} at ${start}`
  return `+${inserted} at ${start}${end > start ? `, over ${start}–${end}` : ''}`
}

/** What happened, in a sentence or two. */
export function explain(row) {
  const now = `${plural(row.after, 'character')}, cursor at ${row.cursor}`
  if (row.kind === 'change') {
    const kind = kindOf(row)
    if (kind === 'history')
      return `An earlier prompt came back from the history (↑, ↓ or the history search). The box holds ${now}.`
    if (kind === 'clear')
      return `The box was emptied: a prompt was sent, or Ctrl+C cleared it.${row.after > 0 ? ` A key typed since is already in it: ${now}.` : ''}`
    if (kind === 'undo') return `An undo put back an earlier text of yours: ${now}.`
    if (kind === 'fill')
      return filler(row) === 'mod-lab'
        ? `The lab put text in the box with $.prompt.fill, as the Fill on this page does: ${now}.`
        : `The ${filler(row)} mod put text in the box with $.prompt.fill: ${now}.`
    if (kind === 'app') return `The app changed the box: ${now}.`
    return `Claude Code changed the box itself: a suggestion or completion taken with Tab, dictation, or a draft put back. It holds ${now}.`
  }
  const { start, end, inserted } = row.splice
  const box = `The box went from ${row.before} to ${plural(row.after, 'character')}.`
  const kind = kindOf(row)
  if (kind === 'paste')
    return `${plural(inserted, 'character')} went in at ${start}${end > start ? `, over ${start}–${end},` : ''} with no single key behind them: a paste, a newline from a keybinding, or keys that came too fast to tell apart. ${box}`
  const key = keyWords(row.key)
  if (kind === 'move')
    return `${key} moved the cursor to ${row.cursor}. Nothing went in and nothing came out: a cursor move is an edit too, so a mod sees every one.`
  if (kind === 'delete') return `${key} removed ${plural(end - start, 'character')}, ${start}–${end}. ${box}`
  if (kind === 'replace')
    return `${key} typed over ${start}–${end}, putting in ${plural(inserted, 'character')}. ${box}`
  const what = row.key === 'text' ? 'a character' : row.key === 'space' ? 'a space' : key
  return `You typed ${what} at position ${start}. ${box}`
}

/** What the row says about the hooks, each note with its tone: when they were asked, and what those beneath the lab did. */
export function notesOf(row) {
  const notes = [
    row.kind === 'change'
      ? { tone: 'muted', text: 'prompt.change told the hooks after the box changed: a mod can watch it, not alter it.' }
      : {
          tone: 'muted',
          text: 'prompt.edit asked the hooks before the box changed, so a mod could have changed this edit.',
        },
  ]
  if (row.isRewritten)
    notes.push({
      tone: 'rewritten',
      text: 'A hook beneath the lab changed what landed: the box it answered is not the splice the editor made.',
    })
  if (row.decorations > 0)
    notes.push({
      tone: 'painted',
      text: `Hooks beneath the lab painted ${plural(row.decorations, 'run')} over the box: color, underline or ghost text that is not part of the draft.`,
    })
  return notes
}

function keyLiteral(name) {
  if (name === null) return 'undefined (a paste, or no single key)'
  const { modifiers, key } = keyParts(name)
  const flags = modifiers.map(modifier => `, ${modifier}: true`).join('')
  return key === 'text' ? `{ key: '…'${flags} } (one character; the lab keeps none)` : `{ key: '${key}'${flags} }`
}

/** The hook a mod would write to see this row, with the values it would have seen. */
export function hookLines(row) {
  if (row.kind === 'change') {
    const name = filler(row)
    return [
      "on('prompt.change', async ($, e, next) => {",
      `  // e.origin:  ${name === null ? `{ kind: '${row.origin}' }` : `{ kind: 'plugin', name: '${name}' }`}`,
      `  // e.text:    ${plural(row.after, 'character')}`,
      `  // e.cursor:  ${row.cursor}`,
      '  return next(e) // the box has already changed',
      '})',
    ].join('\n')
  }
  const { start, end, inserted } = row.splice
  return [
    "on('prompt.edit', async ($, e, next) => {",
    `  // e.key:       ${keyLiteral(row.key)}`,
    `  // e.text:      ${plural(row.before, 'character')}, the draft before`,
    `  // e.start:     ${start}`,
    `  // e.end:       ${end}`,
    `  // e.inputText: ${inserted === 0 ? "''" : `'…' (${plural(inserted, 'character')})`}`,
    '  const box = await next(e)',
    `  // box.text:    ${plural(row.after, 'character')}${row.isRewritten ? ', rewritten beneath the lab' : ''}`,
    `  // box.cursor:  ${row.cursor}`,
    ...(row.decorations > 0
      ? [`  // box.decorations: ${plural(row.decorations, 'run')}, painted beneath the lab`]
      : []),
    '  return box',
    '})',
  ].join('\n')
}

/** Counts for the line under the ribbon, and the box as the newest row left it. */
export function summaryOf(rows) {
  const newest = rows.at(-1)
  return {
    edits: rows.filter(row => row.kind === 'edit').length,
    changes: rows.filter(row => row.kind === 'change').length,
    rewritten: rows.filter(row => row.isRewritten).length,
    painted: rows.filter(row => row.decorations > 0).length,
    box: newest === undefined ? null : { length: newest.after, cursor: newest.cursor },
  }
}

/** The walkthrough: each thing to try, and the row that shows it was done. */
export const TRIES = [
  {
    id: 'type',
    label: 'Type a few words',
    hint: 'Each key is one prompt.edit, sent before the box changes.',
    test: row => kindOf(row) === 'type',
  },
  {
    id: 'delete',
    label: 'Delete some with Backspace',
    hint: 'A deletion is an edit that puts nothing in.',
    test: row => kindOf(row) === 'delete',
  },
  {
    id: 'move',
    label: 'Move the cursor with ← or →',
    hint: 'A move is an edit too: nothing taken out, nothing put in.',
    test: row => kindOf(row) === 'move',
  },
  {
    id: 'paste',
    label: 'Paste some text',
    hint: 'A paste is one edit with no key.',
    test: row => kindOf(row) === 'paste',
  },
  {
    id: 'history',
    label: 'Press ↑ to bring back an earlier prompt',
    hint: 'Not an edit: prompt.change, which a mod can watch but not alter.',
    test: row => kindOf(row) === 'history',
  },
  {
    id: 'clear',
    label: 'Clear the box with Ctrl+C',
    hint: 'Another prompt.change. Sending a prompt empties the box the same way.',
    test: row => kindOf(row) === 'clear',
  },
  {
    id: 'fill',
    label: 'Fill the box from this page',
    hint: 'How a mod writes into the box: $.prompt.fill.',
    form: 'fill',
    test: row => kindOf(row) === 'fill',
  },
  {
    id: 'suggest',
    label: 'Suggest a prompt, then press Tab in the empty box',
    hint: '$.prompt.suggest draws dim text; Tab takes it, and the box reports a change by the engine.',
    form: 'suggest',
    test: row => kindOf(row) === 'engine',
  },
  {
    id: 'beneath',
    label: 'Add Close brackets, under Build on it, and type (',
    hint: 'A mod that shapes the box, running beneath the lab: its rows are marked rewritten and painted.',
    test: row => row.isRewritten || row.decorations > 0,
  },
]
