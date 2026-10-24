// The lab's compactor and the session's compactions. While the compactor is
// on, the lab answers session.compact itself: the first message, a summary it
// writes without a model call, and the last few messages. Every compaction,
// whoever answers it, is kept with the messages before and after.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCompactInput, SessionCompactResult, SessionMessage, TurnUsage } from 'claude-code'

import type { LabCompaction, LabCompactMessage, LabCompactor, LabRunSource } from '../types'
import { splitCommand } from './args'
import { clock } from './format'
import { oneLine } from './json'
import { serial } from './runner'

type Dollar = EngineInterface

export const EMPTY_COMPACTOR: LabCompactor = { keep: null, compactions: [] }
const MAX_KEEP = 50
const MAX_COMPACTIONS = 10
const PREVIEW = 80
const NEWEST = 5
/** How a summary the lab wrote begins, so the model and the person can tell it from the engine's. */
export const SUMMARY_MARK = '[mod-lab compactor]'

const compactor = atom({ plugin: 'mod-lab', key: 'compactor' } as const, EMPTY_COMPACTOR)

// Whether the newest compaction waits for the next request to measure what it
// left. A module variable: after a reload that figure stays unknown.
let isMeasuring = false

function plural(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`
}

function tokens(count: number): string {
  return count.toLocaleString('en-US')
}

/**
 * Where the kept tail starts: `keep` from the end, moved past a tool result
 * whose call it would cut off, then back to the start of the response it
 * lands in (the engine keeps a response's thinking, text and tool calls as
 * messages of their own).
 */
export function tailStart(messages: readonly SessionMessage[], keep: number): number {
  let start = Math.max(1, messages.length - keep)
  while (start < messages.length && (messages[start]?.toolResults ?? []).length > 0) start += 1
  while (start > 1 && messages[start]?.role === 'assistant' && messages[start - 1]?.role === 'assistant') start -= 1
  return start
}

/** What the lab puts in place of the messages it drops: what they held, counted, since no model read them. */
export function summaryOf(dropped: readonly SessionMessage[], kept: number, instructions?: string): string {
  const prompts = dropped.filter(message => message.role === 'user' && (message.toolResults ?? []).length === 0).length
  const replies = dropped.filter(message => message.role === 'assistant').length
  const byTool = new Map<string, number>()
  for (const message of dropped) for (const use of message.toolUses) byTool.set(use.tool, (byTool.get(use.tool) ?? 0) + 1)
  const calls = [...byTool.values()].reduce((sum, count) => sum + count, 0)
  const listed = [...byTool].sort((a, b) => b[1] - a[1]).map(([tool, count]) => `${tool} ${count}`).join(', ')
  const lines = [
    `${SUMMARY_MARK} ${dropped.length === 1 ? 'One earlier message was' : `${dropped.length} earlier messages were`} removed here by the mod-lab mod's compactor, which makes no model call: they are counted, not summarized.`,
    `They held ${plural(prompts, 'message')} from the user, ${replies} from the assistant, and ${calls === 0 ? 'no tool calls' : `${plural(calls, 'tool call')} (${listed})`}.`,
    `The first message of the conversation is kept above this one${replies > 0 ? ' and was answered in the removed messages' : ''}; ${kept === 1 ? 'the last message is kept' : `the last ${kept} messages are kept`} below it.`,
  ]
  const asked = instructions?.trim() ?? ''
  if (asked !== '') lines.push(`The compaction was given these instructions: "${asked}". No model read the removed messages, so they were not applied.`)
  return lines.join(' ')
}

/** The lab's compaction: the first message, its summary of the ones between, and the tail; null when nothing lies between. */
export function compacted(messages: readonly SessionMessage[], keep: number, instructions?: string): SessionMessage[] | null {
  const first = messages[0]
  const start = tailStart(messages, keep)
  const dropped = messages.slice(1, start)
  if (first === undefined || dropped.length === 0) return null
  const summary: SessionMessage = { role: 'user', text: summaryOf(dropped, messages.length - start, instructions), toolUses: [] }
  return [first, summary, ...messages.slice(start)]
}

function isSame(a: SessionMessage, b: SessionMessage): boolean {
  return a === b || (a.handle !== undefined && a.handle === b.handle)
}

/** A message in brief; the tools it calls or answers stand in for an empty text. */
export function briefOf(message: SessionMessage, isKept: boolean, toolOf: ReadonlyMap<string, string>): LabCompactMessage {
  const results = message.toolResults ?? []
  const chars =
    message.text.length +
    message.toolUses.reduce((sum, use) => sum + JSON.stringify(use.input ?? {}).length, 0) +
    results.reduce((sum, result) => sum + result.text.length, 0)
  const text = oneLine(message.text).replace(/\s+/g, ' ').trim()
  const label =
    text !== ''
      ? text
      : message.toolUses.length > 0
        ? `(calls ${message.toolUses.map(use => use.tool).join(', ')})`
        : results.length > 0
          ? `(results of ${results.map(result => toolOf.get(result.tool_use_id) ?? 'a tool').join(', ')})`
          : '(no text or tool calls)'
  return { role: message.role, chars, tools: message.toolUses.length, results: results.length, preview: label.length > PREVIEW ? `${label.slice(0, PREVIEW)}…` : label, isKept }
}

/** A compaction as kept: the messages before, marked kept or dropped, and after, marked carried over or built. */
export function compactionOf(seen: { e: SessionCompactInput; result: SessionCompactResult; by: string; tokens: number | null; at: number }): LabCompaction {
  const { e, result } = seen
  const toolOf = new Map(e.messages.flatMap(message => message.toolUses.map(use => [use.tool_use_id, use.tool] as const)))
  const stood = result.skip === undefined ? result : null
  const after = stood?.messages ?? null
  const usage = stood?.usage
  const sizedBy = stood?.tokensBefore !== undefined ? 'engine' : seen.tokens !== null ? 'request' : null
  return {
    at: seen.at,
    trigger: e.trigger,
    agentId: e.agentId ?? null,
    by: seen.by,
    before: e.messages.map(message => briefOf(message, after?.some(one => isSame(one, message)) ?? false, toolOf)),
    after: after === null ? null : after.map(message => briefOf(message, e.messages.some(one => isSame(one, message)), toolOf)),
    tokensBefore: stood?.tokensBefore ?? seen.tokens,
    tokensAfter: sizedBy === 'engine' ? (stood?.tokensAfter ?? null) : null,
    sizedBy,
    summarizer:
      usage === undefined
        ? null
        : { input: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, output: usage.output_tokens },
    skipped: result.skip ?? null,
  }
}

export function withCompaction(kept: LabCompactor, compaction: LabCompaction): LabCompactor {
  return { ...kept, compactions: [...kept.compactions, compaction].slice(-MAX_COMPACTIONS) }
}

/** Fills in the newest compaction's size afterwards, as the request after it measured it. */
export function withMeasured(kept: LabCompactor, measured: number): LabCompactor {
  const newest = kept.compactions.at(-1)
  if (newest === undefined || newest.skipped !== null || newest.sizedBy !== 'request' || newest.tokensAfter !== null) return kept
  return { ...kept, compactions: [...kept.compactions.slice(0, -1), { ...newest, tokensAfter: measured }] }
}

function sizeOf(one: LabCompaction): string {
  if (one.tokensBefore === null) return ''
  const after = one.tokensAfter === null ? (one.sizedBy === 'request' ? 'a size the next request will measure' : 'a size not recorded') : tokens(one.tokensAfter)
  if (one.sizedBy === 'request') return `; a request's whole input ${tokens(one.tokensBefore)} tokens before, ${after} after`
  return `; ${tokens(one.tokensBefore)} tokens to ${after}${one.sizedBy === 'engine' ? ", by the engine's count" : ''}`
}

export function compactionLine(one: LabCompaction): string {
  const head = `${clock(one.at)} ${one.trigger}${one.agentId === null ? '' : ` (agent ${one.agentId})`}, by ${one.by}`
  if (one.skipped !== null) return `${head}: skipped, ${one.skipped}`
  const cost =
    one.summarizer !== null
      ? `; the summarizer read ${tokens(one.summarizer.input)} tokens and wrote ${tokens(one.summarizer.output)}`
      : one.by === 'mod-lab'
        ? '; no model call'
        : ''
  return `${head}: ${one.before.length} messages to ${one.after?.length ?? 0}${sizeOf(one)}${cost}`
}

// session.compact is one of the events an organization's management keeps from installed plugins.
const MANAGED = 'Where an organization manages Claude Code, session.compact hooks do not run in plugins the person installed: there the lab neither lists compactions nor answers them.'

export function formatCompactor(kept: LabCompactor): string {
  const lines = [
    kept.keep === null
      ? "The lab's compactor is off: compactions are the engine's. /mod-lab compactor keep <n> turns it on."
      : `The lab's compactor is on: a compaction keeps the first message and the last ${plural(kept.keep, 'message')}, and the lab writes the summary between them itself, with no model call. /mod-lab compactor off ends it.`,
    MANAGED,
  ]
  if (kept.compactions.length === 0) return [...lines, 'No compaction in this session yet.'].join('\n')
  return [...lines, '', 'Compactions, newest first:', ...kept.compactions.slice(-NEWEST).reverse().map(one => `  ${compactionLine(one)}`)].join('\n')
}

/** Keeps a change. Not awaited: it waits behind any run in progress, which may be waiting on this compaction. */
function save($: Dollar, change: (kept: LabCompactor) => LabCompactor): void {
  void serial(() => update($, compactor, change))
}

/** Called from the lab's turn.step hook: the main loop's first request after a compaction measures what it left. */
export function noteRequest($: Dollar, e: { agentId?: string }, usage: TurnUsage | null): void {
  if (!isMeasuring || e.agentId !== undefined || usage === null) return
  isMeasuring = false
  const measured = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  save($, kept => withMeasured(kept, measured))
}

function noteCompaction($: Dollar, compaction: LabCompaction, e: SessionCompactInput): void {
  if (compaction.skipped === null && compaction.sizedBy === 'request' && e.trigger !== 'precompute' && e.agentId === undefined) isMeasuring = true
  save($, kept => withCompaction(kept, compaction))
}

/** The last request's input, the conversation's size as the engine last sent it; null where it has none. */
async function contextTokens($: Dollar): Promise<number | null> {
  try {
    return (await $.session.usage()).context.tokens ?? null
  } catch {
    return null
  }
}

/** The lab's answer. It leaves out `tokensBefore`, which the engine records by its own count; the lab's figures are whole requests. */
function labCompaction(e: SessionCompactInput, keep: number): SessionCompactResult {
  // A precompute's result would be installed later, perhaps after the compactor is off.
  if (e.trigger === 'precompute') return { skip: 'the lab compacts on its own while its compactor is on' }
  const messages = compacted(e.messages, keep, e.instructions)
  if (messages === null) return { skip: `the lab's compactor keeps the first message and the last ${keep}, and the conversation holds ${e.messages.length}` }
  return { messages }
}

/** Who answered a compaction the lab passed on: the first link beneath it that returned. */
function answeredBy(trace: readonly { plugin: string; outcome: string }[]): string {
  return trace.find(link => link.outcome === 'returned')?.plugin ?? 'engine'
}

/** /mod-lab compactor, keep <n>, off. */
export async function compactorCommand($: Dollar, rest: string): Promise<string> {
  const { head, rest: value } = splitCommand(rest)
  if (head === '') return formatCompactor(await serial(() => read($, compactor)))
  if (head === 'off') {
    await serial(() => update($, compactor, kept => ({ ...kept, keep: null })))
    return "The lab's compactor is off: compactions are the engine's again."
  }
  const keep = Number(value)
  if (head !== 'keep' || !Number.isInteger(keep) || keep < 1 || keep > MAX_KEEP) {
    return `Use /mod-lab compactor keep <n>, n from 1 to ${MAX_KEEP}, for how many of the last messages a compaction keeps; /mod-lab compactor off; or /mod-lab compactor for the compactions so far.`
  }
  await serial(() => update($, compactor, kept => ({ ...kept, keep })))
  return `The lab's compactor is on: a compaction keeps the first message and the last ${plural(keep, 'message')}, with a summary the lab writes between them. /compact compacts now, and a compaction is not undone. ${MANAGED}`
}

/**
 * /mod-lab compact [instructions]: compacts now, through every hook beneath this
 * one, the lab's compactor among them. The engine refuses it from a typed
 * command, which holds the turn; the explorer's button reaches the lab between turns.
 */
export async function compactCommand($: Dollar, instructions: string, from: LabRunSource): Promise<string> {
  let result: SessionCompactResult
  try {
    result = await $.session.compact(instructions === '' ? {} : { instructions })
  } catch (error) {
    const typed = from === 'command' ? " Type /compact instead: the lab's compactor answers it while it is on." : ''
    return `Not compacted: ${error instanceof Error ? error.message : String(error)}.${typed}`
  }
  if (result.skip !== undefined) return `Not compacted: ${result.skip}`
  const newest = (await serial(() => read($, compactor))).compactions.at(-1)
  return `Compacted${newest === undefined ? '' : `: ${compactionLine(newest)}`}. A compaction is not undone.`
}

export const registerCompactor: Register = on => {
  on('session.compact', async ($, e, next) => {
    const { keep } = await read($, compactor)
    const before = await contextTokens($)
    const isLab = keep !== null && e.agentId === undefined
    const result = isLab ? labCompaction(e, keep) : await next(e)
    try {
      noteCompaction($, compactionOf({ e, result, by: isLab ? 'mod-lab' : answeredBy(next.trace), tokens: before, at: Date.now() }), e)
    } catch {
      // A failure here would hand the call to the catch below, and the engine's summarizer, after the lab had answered it.
    }
    return result
  }).catch(($, e, next) => next(e))
}
