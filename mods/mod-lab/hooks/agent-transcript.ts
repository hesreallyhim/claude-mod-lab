import type { EngineInterface, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

type TranscriptBase = { kind: 'agent-transcript'; version: 1; agentId: string }
export type AgentTranscript = TranscriptBase & ({ messages: SessionMessage[] } | { error: string })

/** Preserve the engine's message summaries, including tool inputs and model-visible outputs. */
export async function readAgentTranscript($: EngineInterface, agentId: string): Promise<AgentTranscript> {
  const base = { kind: 'agent-transcript', version: 1, agentId } as const
  if (agentId === '') return { ...base, error: 'Use /mod-lab agent transcript <agentId>; /mod-lab agent lists the ids.' }
  try {
    const messages = await $.session.messages({ agentId })
    return Array.isArray(messages) ? { ...base, messages } : { ...base, error: messages.deny }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

function resultText(result: Pick<ToolResultSummary, 'text' | 'result'>): string {
  if (result.text !== '') return result.text
  return result.result === undefined ? '(No text output.)' : JSON.stringify(result.result, null, 2)
}

function toolCallText(use: ToolUseSummary, answered: Set<string>): string {
  const lines = [`Tool call · ${use.tool} (${use.tool_use_id})`, JSON.stringify(use.input, null, 2)]
  if (!answered.has(use.tool_use_id) && (use.text !== undefined || use.result !== undefined)) {
    lines.push(`Tool ${use.isError ? 'error' : 'result'} · ${use.tool}`, resultText({ text: use.text ?? '', result: use.result }))
  }
  return lines.join('\n')
}

function messageText(message: SessionMessage, tools: Map<string, string>, answered: Set<string>): string {
  const parts = message.text === '' ? [] : [`${message.role}: ${message.text}`]
  parts.push(...message.toolUses.map(use => toolCallText(use, answered)))
  parts.push(...(message.toolResults ?? []).map(result =>
    `Tool ${result.isError ? 'error' : 'result'} · ${tools.get(result.tool_use_id) ?? result.tool_use_id}\n${resultText(result)}`,
  ))
  return parts.length === 0 ? `${message.role}: (No text or tool details in this message summary.)` : parts.join('\n\n')
}

/** A readable CLI transcript; the browser receives the full envelope instead. */
export function formatAgentTranscript(transcript: AgentTranscript): string {
  if ('error' in transcript) return `No transcript: ${transcript.error}`
  if (transcript.messages.length === 0) return `${transcript.agentId} has no rows yet.`
  const tools = new Map(transcript.messages.flatMap(message => message.toolUses.map(use => [use.tool_use_id, use.tool] as const)))
  const answered = new Set(transcript.messages.flatMap(message => (message.toolResults ?? []).map(result => result.tool_use_id)))
  return transcript.messages.map(message => messageText(message, tools, answered)).join('\n\n')
}
