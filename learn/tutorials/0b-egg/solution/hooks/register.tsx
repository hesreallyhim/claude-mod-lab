// egg: an egg timer above the prompt. The finished mod of a tutorial,
// learn/tutorials/0b-egg/README.md.

import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, Timer } from 'claude-code'

type Dollar = EngineInterface

/** The timer: how long it was set for and when it ends; null until /egg sets one. */
const egg = atom({ plugin: 'egg', key: 'egg' } as const, null)

/** Draws the band again once a second while the timer runs. */
let redraw: Timer | null = null

/** Stops the redrawing when the time is up. */
let done: Timer | null = null

/** The colour of the bar, for the share of the time still left: 1 when it is set, 0 when it is up. */
function colorFor(share: number): Color {
  if (share < 0.2) return 'error'
  if (share < 0.5) return 'warning'
  return 'success'
}

/** Sets the timer for `minutes`, and draws the band every second until it is up. */
async function start($: Dollar, minutes: number): Promise<void> {
  redraw?.cancel()
  done?.cancel()
  const ms = minutes * 60_000
  const now = await $.clock.now()
  await update($, egg, () => ({ ms, endsAt: now + ms }))
  redraw = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  done = $.clock.after(ms, () => {
    redraw?.cancel()
    $.ui.invalidate('ui.render')
  })
}

// Plain helpers.

/** The minutes in what follows /egg: `5` is 5; nothing, or no number, is 3. */
function minutesOf(text: string): number {
  const minutes = Number(text.trim())
  return minutes > 0 ? minutes : 3
}

/** `2:05`: the time left in minutes and seconds, counting a part of a second as a whole one. */
function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A bar `width` blocks long, as much of it filled as the share left. */
function bar(share: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, share)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'egg', description: 'An egg timer above the prompt: /egg 5 for five minutes' })
    return next(e)
  })

  on('command.run', { command: 'egg' }, async ($, e) => {
    const minutes = minutesOf(e.args)
    await start($, minutes)
    return { text: `The egg timer is set for ${minutes} minute${minutes === 1 ? '' : 's'}.` }
  })

  // The band above the prompt: drawn while a timer is set, and handed on otherwise.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const timer = await read($, egg)
    if (e.props.hasSurvey || timer === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const left = timer.endsAt - (await $.clock.now())
    if (left <= 0) {
      return (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>egg</Text>
          <Text bold color="claude">
            ready
          </Text>
        </Box>
      )
    }
    const share = left / timer.ms
    return (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>egg</Text>
        <Text mono color={colorFor(share)}>
          {bar(share, 20)}
        </Text>
        <Text>{`${clock(left)} left`}</Text>
      </Box>
    )
  })
}
