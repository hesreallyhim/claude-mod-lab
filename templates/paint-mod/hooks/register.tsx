// paint-mod: slash commands painted in the prompt box as they are typed. A
// command the session has is drawn bold, a word no command starts with is
// underlined in red, and the rest of the first command a partial word could
// become follows the cursor as ghost text. @-mentions are tinted too.

import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

type Dollar = EngineInterface

// The session's commands, asked for again after a quarter minute: a plugin can add one at any time.
const FRESH_MS = 15_000
let names: readonly string[] = []
let askedAt = Number.NEGATIVE_INFINITY

async function commandNames($: Dollar): Promise<readonly string[]> {
  const now = await $.clock.now()
  if (now - askedAt > FRESH_MS) {
    names = (await $.command.list()).map(command => command.name)
    askedAt = now
  }
  return names
}

/** The paint for a box: its leading /command, as the session's commands make it, and each @mention. */
export function paintOf(text: string, cursor: number, known: readonly string[]): PromptDecoration[] {
  const marks: PromptDecoration[] = []
  const command = /^\/([\w:.-]*)/.exec(text)
  if (command !== null) {
    const word = command[1] ?? ''
    const end = command[0].length
    const first = known.find(name => name.startsWith(word))
    if (known.includes(word)) marks.push({ start: 0, end, bold: true, color: 'suggestion' })
    else if (word !== '' && first === undefined) marks.push({ start: 0, end, underline: true, color: 'error' })
    else if (word !== '' && first !== undefined && cursor === end && end === text.length) marks.push({ start: end, end, virtualText: first.slice(word.length), dimColor: true })
  }
  for (const mention of text.matchAll(/(^|\s)(@\S+)/g)) {
    const start = mention.index + (mention[1] ?? '').length
    marks.push({ start, end: start + (mention[2] ?? '').length, color: 'claude' })
  }
  return marks
}

export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!box.text.startsWith('/') && !box.text.includes('@')) return box
    const marks = paintOf(box.text, box.cursor, box.text.startsWith('/') ? await commandNames($) : [])
    return marks.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  }).catch(($, e, next) => next(e))
}
