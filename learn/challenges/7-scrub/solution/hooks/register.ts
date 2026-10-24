// scrub: the solution to the challenge in ../README.md.

import type { Register } from 'claude-code'

// Anthropic and other sk- keys, GitHub tokens, AWS access key ids.
const KEY = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16})\b/g

function redacted(text: string): string {
  return text.replace(KEY, '[redacted]')
}

export const register: Register = on => {
  // Pieces follow the child's writes, not its lines, so a key can span two. Each
  // pipe's text waits here until a newline ends it; the complete lines go on
  // at once, redacted, and what is left goes on when the child ends.
  on('process.spawn', async function* ($, e, next) {
    const stream = next(e)
    const waiting = { stdout: '', stderr: '' }
    for await (const piece of stream) {
      const text = waiting[piece.stream] + piece.text
      const end = text.lastIndexOf('\n') + 1
      waiting[piece.stream] = text.slice(end)
      if (end > 0) yield { ...piece, text: redacted(text.slice(0, end)) }
    }
    for (const pipe of ['stdout', 'stderr'] as const) {
      if (waiting[pipe] !== '') yield { stream: pipe, text: redacted(waiting[pipe]) }
    }
    return stream.result
  })
}
