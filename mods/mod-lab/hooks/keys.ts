// The prompt box as the person edits it: each edit as the lab's prompt.edit
// hook saw it pass, and each change made some other way (going back to an
// earlier prompt, clearing the box, text a plugin put there) as mod-lab-keys
// kept it, in brief.
// Watch only: the hooks pass everything on, and the log keeps lengths, never the draft.

import { atom, read, update } from 'claude-code'
import type { ClientKeyEvent, EngineInterface, PluginState, PromptEditInput, PromptEditResult, Register } from 'claude-code'

import type { LabKey, LabKeys } from '../types'
import { clock } from './format'
import { serial } from './runner'

type Dollar = EngineInterface
// mod-lab-keys' rows, as its contract declares them.
type KeyChanges = PluginState['mod-lab-keys']['changes']
type KeyChange = KeyChanges['rows'][number]

export const EMPTY_KEYS: LabKeys = { rows: [] }
const MAX_ROWS = 100
const NEWEST = 15

const keys = atom({ plugin: 'mod-lab', key: 'keys' } as const, EMPTY_KEYS)

// Changes not yet kept: an edit comes with every key, so they are written in batches behind the queue.
let pending: ((kept: LabKeys) => LabKeys)[] = []

/** A key by name with its modifiers; a character typed plain is `text`, so the log holds nothing of the draft. */
export function keyName(key: ClientKeyEvent | undefined): string | null {
  if (key === undefined) return null
  const isTyped = key.key.length === 1 && key.ctrl !== true && key.meta !== true
  const modifiers = [key.ctrl ? 'ctrl' : null, key.meta ? 'meta' : null, key.shift && !isTyped ? 'shift' : null]
  return [...modifiers, isTyped ? 'text' : key.key].filter(part => part !== null).join('+')
}

export function editRow(e: PromptEditInput, result: PromptEditResult, at: number): Omit<LabKey, 'seq'> {
  const spliced = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
  return {
    at,
    kind: 'edit',
    origin: e.origin.kind,
    key: keyName(e.key),
    splice: { start: e.start, end: e.end, inserted: e.inputText.length },
    before: e.text.length,
    after: result.text.length,
    cursor: result.cursor,
    decorations: result.decorations?.length ?? 0,
    isRewritten: result.text !== spliced,
  }
}

export function changeRow(change: KeyChange): Omit<LabKey, 'seq'> {
  return { at: change.at, kind: 'change', origin: change.origin, key: null, splice: null, before: null, after: change.length, cursor: change.cursor, decorations: 0, isRewritten: false }
}

export function withRows(kept: LabKeys, fresh: readonly Omit<LabKey, 'seq'>[]): LabKeys {
  const start = kept.rows.at(-1)?.seq ?? 0
  return { ...kept, rows: [...kept.rows, ...fresh.map((row, index) => ({ ...row, seq: start + index + 1 }))].slice(-MAX_ROWS) }
}

/** The log with mod-lab-keys' changes it does not hold yet, by that plugin's own numbering, in the order they were made. */
export function withChanges(kept: LabKeys, changes: readonly KeyChange[]): LabKeys {
  const seen = kept.changeSeq ?? 0
  const fresh = changes.filter(change => change.seq > seen).sort((a, b) => a.seq - b.seq)
  const last = fresh.at(-1)
  if (last === undefined) return kept
  return { ...withRows(kept, fresh.map(changeRow)), changeSeq: last.seq }
}

function plural(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`
}

export function keyLine(row: LabKey): string {
  const what =
    row.kind === 'change'
      ? `change by ${row.origin}`
      : `edit ${row.key ?? 'paste or burst'}${row.splice === null ? '' : ` at ${row.splice.start}${row.splice.end > row.splice.start ? `-${row.splice.end}` : ''}${row.splice.inserted > 0 ? `, +${row.splice.inserted}` : ''}`}`
  const size = row.before === null ? `${row.after} chars` : `${row.before} -> ${row.after} chars`
  const marks = [row.decorations > 0 ? plural(row.decorations, 'decoration') : null, row.isRewritten ? 'changed beneath the lab' : null].filter(mark => mark !== null)
  return `${clock(row.at)} ${what}, ${size}, cursor ${row.cursor}${marks.length === 0 ? '' : `; ${marks.join(', ')}`}`
}

/** The log in text; `note`, when given, says why it holds no change rows. */
export function formatKeys(kept: LabKeys, note: string | null = null): string {
  const tail = note === null ? [] : ['', note]
  if (kept.rows.length === 0) return ['No edit or change to the prompt box since the lab loaded.', ...tail].join('\n')
  const edits = kept.rows.filter(row => row.kind === 'edit').length
  return [
    `The prompt box's last ${kept.rows.length} changes: ${plural(edits, 'edit')} as typed, ${plural(kept.rows.length - edits, 'change')} another way. Lengths only; the draft is not kept.`,
    '',
    ...kept.rows.slice(-NEWEST).reverse().map(row => `  ${keyLine(row)}`),
    ...tail,
  ].join('\n')
}

async function flush($: Dollar): Promise<void> {
  if (pending.length === 0) return
  const changes = pending
  pending = []
  await update($, keys, kept => changes.reduce((current, change) => change(current), kept))
}

/** Keeps a change to the log. Not awaited: it waits behind any run in progress, so a row is built before, at the time it happened. */
function note($: Dollar, change: (kept: LabKeys) => LabKeys): void {
  pending.push(change)
  void serial(() => flush($))
}

/** The change rows mod-lab-keys keeps; null when its state is unavailable. */
async function keptChanges($: Dollar): Promise<KeyChanges | null> {
  try {
    const { value } = await $.state.get({ plugin: 'mod-lab-keys', key: 'changes' })
    return value ?? null
  } catch {
    return null
  }
}

/** Explain where changes made outside prompt.edit are recorded. */
function changesNote(kept: LabKeys): string | null {
  if (kept.rows.some(row => row.kind === 'change')) return null
  return "No change has come another way yet: mod-lab-keys keeps those (going back to an earlier prompt, clearing the box, text a plugin put there) as they come."
}

/**
 * The log, with any change mod-lab-keys kept that the lab's hook on its writes
 * missed. All the reads in one dispatch see the same snapshot of the store,
 * so this runs in the queue, after the edits waiting there are written, and
 * answers what it wrote.
 */
async function readLog($: Dollar): Promise<LabKeys> {
  const changes = await keptChanges($)
  const kept = await read($, keys)
  const isBehind = changes !== null && changes.rows.some(change => change.seq > (kept.changeSeq ?? 0))
  return isBehind ? update($, keys, current => withChanges(current, changes.rows)) : kept
}

/** /mod-lab keys: the prompt box's newest edits, and the changes mod-lab-keys kept. */
export async function keysReport($: Dollar): Promise<string> {
  const kept = await serial(() => readLog($))
  return formatKeys(kept, changesNote(kept))
}

export const registerKeys: Register = on => {
  // Every edit the person makes, passed on unchanged; the answer from beneath is the box the editor shows.
  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    const row = editRow(e, result, Date.now())
    note($, kept => withRows(kept, [row]))
    return result
  }).catch(($, e, next) => next(e))

  // mod-lab-keys records prompt.change; each change joins the log here as it is written.
  on('state.set', { plugin: 'mod-lab-keys', key: 'changes' }, async ($, e, next) => {
    const result = await next(e)
    const changes = e.value.rows
    note($, kept => withChanges(kept, changes))
    return result
  }).catch(($, e, next) => next(e))
}
