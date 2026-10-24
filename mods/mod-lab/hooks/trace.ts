import type { LabStream, LabTraceRow } from '../types'
import type { Chain } from './inspect'
import { linksOf } from './inspect'
import { clip, compact, summarize, TRACE_LIMITS } from './json'
import { streamLine } from './streams'

type Fields = Readonly<Record<string, unknown>>

function fieldsOf(value: unknown): Fields {
  return value !== null && typeof value === 'object' ? (value as Fields) : {}
}

function textOf(value: unknown, chars: number): string {
  return typeof value === 'string' ? clip(value.replace(/\s+/g, ' '), chars) : ''
}

/** One line saying what happened, per event; the full input and result ride beside it. */
export function summaryOf(event: string, input: unknown, result: unknown): string {
  const e = fieldsOf(input)
  const r = fieldsOf(result)
  switch (event) {
    case 'tool.call': {
      const detail = textOf(e.command, 60) || textOf(e.file_path, 60) || textOf(e.pattern, 60)
      const outcome = typeof r.deny === 'string' ? `denied: ${textOf(r.deny, 60)}` : r.isError === true ? 'error' : 'ok'
      return `${String(e.tool)}${detail ? ` ${detail}` : ''} -> ${outcome}`
    }
    case 'prompt.submit':
      return `"${textOf(e.text, 80)}"`
    case 'command.run':
      return `/${String(e.command)}${e.args ? ` ${textOf(e.args, 60)}` : ''}`
    case 'turn.start':
      return e.agentId === undefined ? 'main loop' : `agent ${String(e.agentId)}`
    case 'turn.step': {
      const uses = Array.isArray(r.toolUses) ? r.toolUses.length : 0
      const answer = textOf(r.answer, 50)
      const outcome = uses > 0 ? `${uses} tool call${uses === 1 ? '' : 's'}` : answer ? `"${answer}"` : String(r.stopReason ?? 'no answer')
      const loop = e.agentId === undefined ? '' : `, agent ${String(e.agentId)}`
      return `request ${Number(e.index) + 1}${loop}, ${String(e.messageCount)} messages, ${String(e.model)} -> ${outcome}`
    }
    case 'turn.complete':
      return `${String(e.reason)}, ${Math.round(Number(e.durationMs ?? 0) / 100) / 10}s${e.agentId === undefined ? '' : `, agent ${String(e.agentId)}`}`
    case 'session.start':
      return textOf(e.cwd, 80)
    default:
      return compact(summarize(input, TRACE_LIMITS), 80)
  }
}

export function traceRow(next: Chain, input: unknown, result: unknown, at: number, stream?: LabStream): Omit<LabTraceRow, 'seq'> {
  const chain = linksOf(next.trace, summarize(input, TRACE_LIMITS))
  const row = {
    event: next.event,
    at,
    ms: Math.round(chain.reduce((sum, link) => sum + link.ms, 0)),
    summary: summaryOf(next.event, input, result),
    input: summarize(input, TRACE_LIMITS),
    result: summarize(result, TRACE_LIMITS),
    chain,
  }
  return stream === undefined ? row : { ...row, summary: `${row.summary}; ${streamLine(stream)}`, stream }
}
