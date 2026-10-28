// keycast-mod: the keys you press in the prompt box, drawn in the band above it
// as you press them, for screen recordings and pairing. Every edit reaches
// prompt.edit with its key, cursor moves included; the band empties two
// seconds after the last one. /keycast-mod off hands the band back.

// Inactive when loaded. /keycast-mod enables this session; /keycast-mod off disables it.

import { atom, read, update } from 'claude-code'
import type { ClientKeyEvent, Register, Timer } from 'claude-code'

type Cap = { face: string; count: number }

const caps = atom({ plugin: 'keycast-mod', key: 'caps' } as const, [])
const isShown = atom({ plugin: 'keycast-mod', key: 'isShown' } as const, false)

// Keycaps drawn at once, the newest last, and how long they stay after the last key.
const MOST = 12
const FADE_MS = 2_000

const GLYPHS: Record<string, string> = { space: '␣', backspace: '⌫', delete: '⌦', return: '⏎', tab: '⇥', escape: 'Esc', left: '←', right: '→', up: '↑', down: '↓', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn' }

/** A key as its keycap: the character typed or the key's glyph, after ⌃ ⌥ ⇧ for what was held; a paste by its length. */
export function faceOf(key: ClientKeyEvent | undefined, inputText: string): string {
  if (key === undefined) return `paste ${inputText.length}`
  const isChar = key.key.length === 1
  const held = `${key.ctrl ? '⌃' : ''}${key.meta ? '⌥' : ''}${key.shift && !isChar ? '⇧' : ''}`
  const face = GLYPHS[key.key] ?? (isChar && held !== '' ? key.key.toUpperCase() : key.key)
  return held + face
}

/** The keycaps with one more key: the same key again counts up, and the oldest falls off. */
export function pushed(list: readonly Cap[], face: string): Cap[] {
  const last = list.at(-1)
  if (last?.face === face) return [...list.slice(0, -1), { face, count: last.count + 1 }]
  return [...list, { face, count: 1 }].slice(-MOST)
}

// The timer that empties the band; a reload drops it with the module.
let fade: Timer | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'keycast-mod', description: 'The keys you press, above the prompt: /keycast-mod on, /keycast-mod off' })
    return next(e)
  })

  on('command.run', { command: 'keycast-mod' }, async ($, e) => {
    const action = e.args.trim()
    if (!['', 'on', 'off'].includes(action)) return { text: 'Usage: /keycast-mod [on|off]' }
    const shown = action !== 'off'
    fade?.cancel()
    fade = null
    await update($, caps, () => [])
    await update($, isShown, () => shown)
    return { text: shown ? 'Your keys show above the prompt as you press them.' : 'Keycast is off; /keycast-mod on brings it back.' }
  })

  on('prompt.edit', async ($, e, next) => {
    if (!(await read($, isShown))) return next(e)
    const box = await next(e)
    await update($, caps, list => pushed(list, faceOf(e.key, e.inputText)))
    fade?.cancel()
    fade = $.clock.after(FADE_MS, () => {
      void update($, caps, () => []).catch(() => undefined)
    })
    return box
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) return next(e)
    const list = await read($, caps)
    if (list.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={1}>
        {list.map((cap, index) => (
          <Box key={`cap:${index}`} flexDirection="row">
            <Text inverse bold={index === list.length - 1}>{` ${cap.face} `}</Text>
            {cap.count > 1 && <Text dimColor>{`×${cap.count}`}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
