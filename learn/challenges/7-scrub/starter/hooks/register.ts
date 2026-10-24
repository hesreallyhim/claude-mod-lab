// scrub: a challenge. ../README.md says what to do; the checks in
// learn/challenges/7-scrub/checks say when it is done.

import type { Register } from 'claude-code'

// Anthropic and other sk- keys, GitHub tokens, AWS access key ids.
const KEY = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16})\b/g

export const register: Register = on => {
  // Redacts each piece of a child's output on its way to the plugin that started it.
  on('process.spawn', async function* ($, e, next) {
    const stream = next(e)
    for await (const piece of stream) yield { ...piece, text: piece.text.replace(KEY, '[redacted]') }
    return stream.result
  })
}
