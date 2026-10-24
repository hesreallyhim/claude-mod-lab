// brackets-mod: the prompt box, shaped as the person types. An opening
// bracket goes in with its partner and the cursor between them, a closing
// bracket typed in front of the same one steps over it, and after every edit,
// a cursor move included, the bracket beside the cursor is painted with its
// partner. Loaded beneath the lab (npx claude-mod-lab add brackets-mod, then
// a session started there), the explorer's Prompt box page marks the edits it
// rewrote and painted.

import type { PromptDecoration, PromptEditResult, Register } from 'claude-code'

const CLOSER_OF = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
])
const OPENER_OF = new Map([...CLOSER_OF].map(([open, close]) => [close, open]))

/** Where the partner of the bracket at `at` stands in `text`, or -1 when there is none. */
export function partnerOf(text: string, at: number): number {
  const char = text[at] ?? ''
  const closer = CLOSER_OF.get(char)
  const partner = closer ?? OPENER_OF.get(char)
  if (partner === undefined) return -1
  const step = closer === undefined ? -1 : 1
  let depth = 0
  for (let index = at; index >= 0 && index < text.length; index += step) {
    if (text[index] === char) depth += 1
    else if (text[index] === partner) depth -= 1
    if (depth === 0) return index
  }
  return -1
}

/** The bracket just before the cursor, else the one after it, painted with its partner. */
export function bracketPaint(text: string, cursor: number): PromptDecoration[] {
  for (const at of [cursor - 1, cursor]) {
    const partner = partnerOf(text, at)
    if (partner >= 0) return [at, partner].map(index => ({ start: index, end: index + 1, color: 'suggestion', bold: true }))
  }
  return []
}

export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    // One key typed at the cursor; a paste or a typed-over selection goes in as it came.
    const isTyped = e.key !== undefined && e.start === e.end
    const closer = CLOSER_OF.get(e.inputText)
    let box: PromptEditResult
    if (isTyped && closer !== undefined) {
      // Put the partner in too, then the cursor back between them.
      const after = await next({ ...e, inputText: e.inputText + closer })
      box = { ...after, cursor: after.cursor - 1 }
    } else if (isTyped && OPENER_OF.has(e.inputText) && e.text[e.start] === e.inputText) {
      // Answered without next: the key is consumed, and the cursor steps over the closer already there.
      box = { text: e.text, cursor: e.start + 1 }
    } else {
      box = await next(e)
    }
    return { ...box, decorations: [...(box.decorations ?? []), ...bracketPaint(box.text, box.cursor)] }
  }).catch(($, e, next) => next(e))
}
