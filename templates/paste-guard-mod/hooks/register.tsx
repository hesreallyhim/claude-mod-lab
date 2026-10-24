// paste-guard-mod: anything shaped like an API key in the prompt box is painted
// red the moment it goes in, pasted or typed, with a note beside it, and a
// prompt holding one is held back once: Enter again sends it. The shapes are
// a start, not a scanner; add your own to KEY_SHAPES.

import type { PromptDecoration, Register } from 'claude-code'

export const KEY_SHAPES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
]

/** Where the text holds a key's shape: [start, end) spans in order, overlapping ones merged. */
export function keySpans(text: string): Array<[number, number]> {
  const found = KEY_SHAPES.flatMap(shape => [...text.matchAll(shape)].map((match): [number, number] => [match.index, match.index + match[0].length]))
  const merged: Array<[number, number]> = []
  for (const [start, end] of found.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

// The prompt last held back, so the same prompt sent again goes through.
let heldBack: string | null = null

export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const spans = keySpans(box.text)
    if (spans.length === 0) return box
    const pasted: [number, number] = [e.start, e.start + e.inputText.length]
    if (e.key === undefined && spans.some(([start, end]) => start < pasted[1] && end > pasted[0])) $.ui.toast('That paste looks like it holds a key: it is painted red in the box.')
    const marks: PromptDecoration[] = spans.flatMap(([start, end]): PromptDecoration[] => [
      { start, end, color: 'error', underline: true },
      { start: end, end, virtualText: ' ← a key?', color: 'error' },
    ])
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  }).catch(($, e, next) => next(e))

  // Should the guard fail, the prompt goes on: a helper, not a gate to be locked out by.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || keySpans(e.text).length === 0 || heldBack === e.text) {
      heldBack = null
      return next(e)
    }
    heldBack = e.text
    return { drop: 'Held back: this prompt holds what looks like an API key. Press Enter again to send it anyway.' }
  }).catch(($, e, next) => next(e))
}
