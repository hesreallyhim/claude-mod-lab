// chime: a sound when Claude finishes a long answer. The finished mod of a
// tutorial, learn/tutorials/0c-chime/README.md.

import type { Register } from 'claude-code'

/** The sound: a file of the mod's own, in its sounds/ folder. */
const CHIME = { asset: 'sounds/chime.wav' } as const

/** A turn shorter than this ends without a sound: 20 seconds. */
const LONG_MS = 20_000

/** The first sentence of Claude's answer, without Markdown's marks, short enough to listen to. */
function firstSentence(answer: string): string {
  const text = answer.replace(/[`*_#>|]/g, '').replace(/\s+/g, ' ').trim()
  const end = text.search(/[.!?](\s|$)/)
  return (end === -1 ? text : text.slice(0, end + 1)).slice(0, 200)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chime', description: 'Plays the chime, to hear what it sounds like' })
    return next(e)
  })

  on('command.run', { command: 'chime' }, async $ => {
    await $.audio.play(CHIME)
    return { text: 'That was the chime.' }
  })

  // The end of each of Claude's turns. By now the answer is written: `next(e)` lets the engine finish the turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result // one of Claude's agents finishing its work: stay quiet
    const isLong = e.durationMs >= LONG_MS
    if (isLong) {
      await $.audio.play(CHIME)
      $.audio.speak(firstSentence(e.answer)).catch(() => {})
    }
    return result
  })
}
