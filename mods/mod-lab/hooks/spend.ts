// The spend meter: every model call the session's plugins make, by plugin,
// what it cost, and whether it reached the model at all. Free mode is two
// intercepts that answer the lab's own calls with no request sent.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LabInterceptDraft, LabSpend, LabSpendCall, LabSpendTotal, LabUsage } from '../types'
import { serial } from './runner'

type Dollar = EngineInterface

export const EMPTY_SPEND: LabSpend = { calls: [], totals: {} }
const MAX_CALLS = 200
const NEWEST = 8
const ZERO: LabUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const spend = atom({ plugin: 'mod-lab', key: 'spend' } as const, EMPTY_SPEND)

/** What free mode answers: a reply that says what happened, and no tokens. */
export const FREE_ANSWER = {
  isAnswered: true,
  text: 'Free mode: the lab answered this call itself, and no request was sent.',
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}

/** The calls free mode answers. `model.classify` answers a label, which no canned reply can be. */
export const FREE_EVENTS = ['model.complete', 'model.fork'] as const

export function freeDraft(event: string): LabInterceptDraft {
  return { event, behavior: 'answer', scope: 'lab', value: JSON.stringify(FREE_ANSWER), ms: '0' }
}

/** The usage in a model call's result (`{ value: { usage } }`), or null where it carries none. */
export function usageOf(result: unknown): LabUsage | null {
  const value = (result as { value?: unknown } | null | undefined)?.value
  const usage = (value as { usage?: unknown } | null | undefined)?.usage
  if (usage === null || typeof usage !== 'object') return null
  const counts = usage as Record<string, unknown>
  const count = (key: string) => (typeof counts[key] === 'number' ? (counts[key] as number) : 0)
  return { input: count('input_tokens'), output: count('output_tokens'), cacheRead: count('cache_read_input_tokens'), cacheWrite: count('cache_creation_input_tokens') }
}

function isAnsweredResult(result: unknown): boolean {
  const value = (result as { value?: unknown } | null | undefined)?.value
  if (typeof value === 'string') return true
  return (value as { isAnswered?: unknown } | null | undefined)?.isAnswered === true
}

/** One settled call as the meter keeps it. A chain that reached its core tier reached the engine, which sends the request. */
export function spendCall(seen: {
  event: string
  plugin: string
  e: unknown
  trace: readonly { tier: string }[]
  result: unknown
  at: number
  ms: number
}): Omit<LabSpendCall, 'seq'> {
  const model = (seen.e as { model?: unknown } | null)?.model
  return {
    at: seen.at,
    event: seen.event,
    plugin: seen.plugin,
    model: typeof model === 'string' ? model : null,
    isSent: seen.trace.some(link => link.tier === 'core'),
    isAnswered: isAnsweredResult(seen.result),
    usage: usageOf(seen.result),
    ms: seen.ms,
  }
}

export function addSpend(kept: LabSpend, call: Omit<LabSpendCall, 'seq'>): LabSpend {
  const seq = (kept.calls.at(-1)?.seq ?? 0) + 1
  const before = kept.totals[call.plugin] ?? { ...ZERO, calls: 0, sent: 0 }
  const usage = call.usage ?? ZERO
  const total: LabSpendTotal = {
    calls: before.calls + 1,
    sent: before.sent + (call.isSent ? 1 : 0),
    input: before.input + usage.input,
    output: before.output + usage.output,
    cacheRead: before.cacheRead + usage.cacheRead,
    cacheWrite: before.cacheWrite + usage.cacheWrite,
  }
  return { calls: [...kept.calls, { ...call, seq }].slice(-MAX_CALLS), totals: { ...kept.totals, [call.plugin]: total } }
}

/** Keeps a settled call. The write is not awaited: it waits behind any run in progress, which may be waiting on this call. */
export function noteSpend($: Dollar, call: Omit<LabSpendCall, 'seq'>): void {
  void serial(() => update($, spend, kept => addSpend(kept, call)))
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

export function usageLine(usage: LabUsage): string {
  return `in ${count(usage.input)}, out ${count(usage.output)}, cache read ${count(usage.cacheRead)}, cache written ${count(usage.cacheWrite)}`
}

export function formatSpend(kept: LabSpend, isFree: boolean): string {
  const lines = [isFree ? 'Free mode is on: the lab answers its own model.complete and model.fork calls, and sends nothing.' : 'Free mode is off.']
  const plugins = Object.entries(kept.totals)
  if (plugins.length === 0) return [...lines, 'No plugin has made a model call in this session yet.'].join('\n')
  lines.push('', 'Model calls this session, by plugin:')
  for (const [plugin, total] of plugins) lines.push(`  ${plugin}: ${total.calls} call${total.calls === 1 ? '' : 's'}, ${total.sent} sent; ${usageLine(total)}`)
  lines.push('', 'Newest calls, newest first:')
  for (const call of kept.calls.slice(-NEWEST).reverse()) {
    const what = `${call.event}${call.model === null ? '' : ` (${call.model})`}`
    const how = call.isSent ? 'sent' : 'not sent, a hook answered it'
    const cost = call.usage === null ? '' : `; ${usageLine(call.usage)}`
    lines.push(`  #${call.seq} ${call.plugin} ${what}: ${how}, ${call.ms} ms${cost}`)
  }
  return lines.join('\n')
}

export async function spendReport($: Dollar, isFree: boolean): Promise<string> {
  return formatSpend(await serial(() => read($, spend)), isFree)
}

/** For the pane's drawing, which reads the meter to show the session's model calls. */
export async function readSpend($: Dollar): Promise<LabSpend> {
  return read($, spend)
}
