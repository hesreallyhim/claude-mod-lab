// The conversation's rows: each row the session keeps, in brief, as the lab's
// hook on session.append sees it stored, and rows the lab adds itself.
// Compactions are compactor.ts's.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LabReader, LabRow, LabRows } from '../types'
import { serial } from './runner'

type Dollar = EngineInterface

export const EMPTY_ROWS: LabRows = { rows: [] }
const MAX_ROWS = 200
const PREVIEW = 100
const NEWEST = 12

const rows = atom({ plugin: 'mod-lab', key: 'rows' } as const, EMPTY_ROWS)

type Block = { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; input?: unknown; content?: unknown }
type Stored = {
  message: { type: string; name?: string; isMeta?: true; content: readonly Block[] }
  door: string
  origin: Record<string, unknown>
  uuid?: string
  agentId?: string
}

/**
 * A block's text, by its kind: a text block's text, a thinking block's
 * thinking, a tool call's name and input as JSON, a tool result's content.
 * Media and unknown kinds have none, and show as their type.
 */
export function textOf(block: Block): string {
  if (typeof block.text === 'string') return block.text
  if (typeof block.thinking === 'string') return block.thinking
  if (block.type === 'tool_use') return `${typeof block.name === 'string' ? block.name : 'tool'} ${JSON.stringify(block.input ?? {})}`
  if (typeof block.content === 'string') return block.content
  if (Array.isArray(block.content)) return block.content.map(part => textOf(part as Block)).join(' ')
  return ''
}

/** What an empty row is, in words: an attachment that rendered nothing for the model, a hook that added nothing, a notice with no text. */
export function emptyOf(row: Pick<LabRow, 'door' | 'type' | 'name' | 'blocks'>): string {
  if (row.blocks.length > 0) return `(${row.blocks.join(', ')})`
  if (row.door === 'hook-context') return '(a hook that added nothing for the model)'
  if (row.type === 'attachment') return `(attachment ${row.name ?? 'of no named type'}, nothing rendered for the model)`
  if (row.type === 'system') return `(a ${row.name ?? 'notice'} notice with no text)`
  return '(no content on the row)'
}

/** A row's origin in words: the kind, and the name, model or tool it carries. */
export function originOf(origin: Record<string, unknown>): string {
  const kind = String(origin.kind ?? 'unknown')
  const detail = origin.name ?? origin.plugin ?? origin.model ?? origin.tool
  return typeof detail === 'string' ? `${kind} ${detail}` : kind
}

/**
 * Who reads a row, by its type and door: a system row is a notice the model
 * never reads, except a command's output, which the model reads as the
 * person sees it; a hidden (isMeta) row, a hook's context and an attachment
 * are for the model alone; the rest both see.
 */
export function readerOf(type: string, door: string, isMeta: boolean): LabReader {
  if (type === 'system') return door === 'command' ? 'both' : 'person'
  if (isMeta || door === 'hook-context' || door === 'attachment' || type === 'attachment') return 'model'
  return 'both'
}

/** A stored row in brief. `stored` is the row as kept; `sent` what reached the lab's hook, to tell a rewrite beneath. */
export function rowOf(sent: Stored, stored: Stored['message'], at: number): Omit<LabRow, 'seq'> {
  const text = stored.content.map(textOf).join(' ').replace(/\s+/g, ' ').trim()
  return {
    at,
    door: sent.door,
    origin: originOf(sent.origin),
    type: stored.type,
    name: stored.name ?? null,
    uuid: sent.uuid ?? null,
    reader: readerOf(stored.type, sent.door, stored.isMeta === true),
    agentId: sent.agentId ?? null,
    blocks: stored.content.map(block => String(block.type ?? 'unknown')),
    chars: text.length,
    preview: text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text,
    isRewritten: JSON.stringify(stored.content) !== JSON.stringify(sent.message.content),
  }
}

export function withRow(kept: LabRows, row: Omit<LabRow, 'seq'>): LabRows {
  const seq = (kept.rows.at(-1)?.seq ?? 0) + 1
  return { ...kept, rows: [...kept.rows, { ...row, seq }].slice(-MAX_ROWS) }
}

export function formatRows(kept: LabRows): string {
  if (kept.rows.length === 0) return 'No row has been stored since the lab loaded.'
  const tally = (key: (row: LabRow) => string) => {
    const counts = new Map<string, number>()
    for (const row of kept.rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1)
    return [...counts].map(([name, count]) => `${name} ${count}`).join(', ')
  }
  return [
    `The last ${kept.rows.length} rows the conversation kept, by how each came in (its door, in session.append): ${tally(row => row.door)}.`,
    `By who reads them: ${tally(row => row.reader)}.`,
    '',
    'Newest:',
    ...kept.rows
      .slice(-NEWEST)
      .reverse()
      .map(
        row =>
          `  #${row.seq} ${row.door} from ${row.origin}, ${row.type}${row.name === null ? '' : ` ${row.name}`}, for ${row.reader}${row.isRewritten ? ', rewritten beneath the lab' : ''}: ${row.preview || emptyOf(row)}`,
      ),
  ].join('\n')
}

/** Keeps a change. Not awaited: it waits behind any run in progress, which may be waiting on this row. */
function save($: Dollar, change: (kept: LabRows) => LabRows): void {
  void serial(() => update($, rows, change))
}

export async function rowsReport($: Dollar): Promise<string> {
  return formatRows(await serial(() => read($, rows)))
}

/** /mod-lab note: a hidden row the model reads and the person does not see. */
export async function addNote($: Dollar, text: string): Promise<string> {
  if (text === '')
    return 'Use /mod-lab note <text>: add model context, hidden from the chat display but saved in JSONL when session persistence is enabled. Starts no model turn.'
  const stored = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  return stored.deny === undefined
    ? `Accepted note ${stored.uuid} for model context. Hidden from the chat display; saved in JSONL when session persistence is enabled. No model turn started.`
    : `Not kept: ${stored.deny}`
}

/** /mod-lab notice: a line the person sees and the model never reads. */
export async function addNotice($: Dollar, text: string): Promise<string> {
  if (text === '') return 'Use /mod-lab notice <text>: add a chat notice, saved in JSONL when session persistence is enabled. The notice row is excluded from model input; the typed command and its reply are separate records.'
  const stored = await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
  return stored.deny === undefined
    ? `Accepted notice ${stored.uuid} for the chat display. Saved in JSONL when session persistence is enabled; the notice row is excluded from model input. No model turn started.`
    : `Not kept: ${stored.deny}`
}

export const registerRows: Register = on => {
  // Every row as it is stored, passed on unchanged. It runs for every row, so it only notes.
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined)
      save($, kept => withRow(kept, rowOf(e as never, result.message as never, Date.now())))
    return result
  }).catch(($, e, next) => next(e))
}
