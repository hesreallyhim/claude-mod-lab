// tick: a stopwatch in a pane. The finished mod of the first tutorial,
// learn/tutorials/0a-tick/README.md.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

type Dollar = EngineInterface

/** The seconds on the stopwatch, kept in $.state for the session. */
const seconds = atom({ plugin: 'tick', key: 'seconds' } as const, 0)

/** The timer that ticks the stopwatch while it runs; null while it is stopped. */
let timer: Timer | null = null

/** One second more on the stopwatch. */
async function tick($: Dollar): Promise<void> {
  await update($, seconds, n => n + 1)
}

/** Starts the stopwatch ticking, once a second. */
function start($: Dollar): void {
  timer = $.clock.every(1000, () => tick($))
  $.ui.invalidate('ui.render')
}

/** Stops the stopwatch. */
function stop($: Dollar): void {
  timer?.cancel()
  timer = null
  $.ui.invalidate('ui.render')
}

// Drawing the time.

/** `0:07`, `1:30`: minutes, then seconds. */
function face(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Each character as five rows of blocks, three wide (the colon one wide). */
const GLYPHS: Record<string, string[]> = {
  '0': ['███', '█ █', '█ █', '█ █', '███'],
  '1': ['  █', '  █', '  █', '  █', '  █'],
  '2': ['███', '  █', '███', '█  ', '███'],
  '3': ['███', '  █', '███', '  █', '███'],
  '4': ['█ █', '█ █', '███', '  █', '  █'],
  '5': ['███', '█  ', '███', '  █', '███'],
  '6': ['███', '█  ', '███', '█ █', '███'],
  '7': ['███', '  █', '  █', '  █', '  █'],
  '8': ['███', '█ █', '███', '█ █', '███'],
  '9': ['███', '█ █', '███', '  █', '███'],
  ':': [' ', '█', ' ', '█', ' '],
}

/** The time in big digits: five lines of text. */
function bigDigits(text: string): string[] {
  return [0, 1, 2, 3, 4].map(row => [...text].map(char => GLYPHS[char]?.[row] ?? '').join(' '))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tick', description: 'A stopwatch in a pane' })
    return next(e)
  })

  on('command.run', { command: 'tick' }, async $ => {
    const opened = await $.ui.open({ id: 'tick', title: 'tick', focus: true })
    return { text: opened.isPlaced ? 'The stopwatch is in its pane.' : `The pane is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'tick' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const time = face(await read($, seconds))
    const isRunning = timer !== null
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          {bigDigits(time).map(line => (
            <Text mono bold>
              {line}
            </Text>
          ))}
        </Box>
        <Text dimColor>{`${time}  ${isRunning ? 'running' : 'stopped'}`}</Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="tick" label="+1 s" hotkey="t" onPress={() => void tick($)} />
          <Button key="start" label={isRunning ? 'Stop' : 'Start'} hotkey="s" onPress={() => (isRunning ? stop($) : start($))} />
        </Box>
      </Box>
    )
  })
}
