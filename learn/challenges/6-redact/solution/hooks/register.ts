// redact: the solution to the challenge in ../README.md.

import type { Register } from 'claude-code'

// Anthropic and other sk- keys, GitHub tokens, AWS access key ids.
const KEY = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16})\b/g

type Block = { type: string; text?: unknown; content?: unknown }

function redacted(text: string): string {
  return text.replace(KEY, '[redacted]')
}

/** A block with every key in its text redacted; a tool result's content too, string or blocks. Other blocks as they came. */
function redactBlock(block: Block): Block {
  if (block.type === 'text' && typeof block.text === 'string') return { ...block, text: redacted(block.text) }
  if (block.type === 'tool_result' && typeof block.content === 'string') return { ...block, content: redacted(block.content) }
  if (block.type === 'tool_result' && Array.isArray(block.content)) return { ...block, content: block.content.map(part => redactBlock(part as Block)) }
  return block
}

export const register: Register = on => {
  // Every row the conversation keeps passes here before it is stored: prompts, replies, tool results, context.
  on('session.append', ($, e, next) => {
    const content = e.message.content.map(block => redactBlock(block as Block))
    const isChanged = JSON.stringify(content) !== JSON.stringify(e.message.content)
    return next(isChanged ? { ...e, message: { ...e.message, content: content as typeof e.message.content } } : e)
  })
}
