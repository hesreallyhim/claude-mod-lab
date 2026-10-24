// Shared by the triage checks; not a check itself.

import type { On } from 'claude-code'

type Block = { text: string; cache?: true }

/** A completion as it reaches the model beneath the mod. */
export type Sent = {
  model: string
  prompt: string
  promptBlocks?: readonly Block[]
  system?: string
  systemBlocks?: readonly Block[]
  maxTokens?: number
  timeoutMs?: number
}

const USAGE = { input_tokens: 9, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** A model reply, as `$.model.complete` resolves with it. */
export function replying(text: string) {
  return { value: { isAnswered: true as const, text, usage: USAGE } }
}

/** The model beneath the mod: answers each completion as `answer` says, recording what it was sent. */
export function model(on: On, answer: (sent: Sent) => unknown): Sent[] {
  const sent: Sent[] = []
  on('model.complete', ($, e) => {
    sent.push(e)
    return answer(e) as never
  })
  return sent
}

/** Records the context each prompt carries on to the main model. */
export function contextSent(on: On): string[][] {
  const sent: string[][] = []
  on('prompt.submit', ($, e) => {
    sent.push([...(e.context ?? [])])
    return { text: e.text, context: e.context ?? [] }
  })
  return sent
}

/** A prompt the person typed. */
export function typed(text: string) {
  return { text, wait: false, origin: { kind: 'composer' as const } }
}

/** The first block marked for the cache, in the system prompt or the prompt, and the blocks after it. */
export function cachedPart(sent: Sent): { marked: Block | undefined; after: string } {
  for (const blocks of [sent.systemBlocks ?? [], sent.promptBlocks ?? []]) {
    const index = blocks.findIndex(block => block.cache === true)
    if (index !== -1) return { marked: blocks[index], after: [...blocks.slice(index + 1), ...(blocks === sent.systemBlocks ? (sent.promptBlocks ?? []) : [])].map(block => block.text).join('\n') }
  }
  return { marked: undefined, after: '' }
}
