// image-mod: an Image in a pane, its RGBA pixels made here and swapped by
// $.ui.blit. One of the gallery's techniques as a mod of its own;
// examples/README.md says where the rest are.

import type { EngineInterface, Register, Timer } from 'claude-code'

type Dollar = EngineInterface

const PANE = 'image-mod'
const KEY = 'hues'
const WIDTH = 96
const HEIGHT = 48
const COLUMNS = 32
const ROWS = 8
const FRAME_MS = 100

// The animation lives in module variables: a reload stops its timer, so state saying it plays would be wrong.
let timer: Timer | null = null
let frame = 0

/** A hue from 0 to 1 as red, green and blue. */
function rgb(hue: number): [number, number, number] {
  const channel = (offset: number) => Math.round(127.5 + 127.5 * Math.cos(2 * Math.PI * (hue - offset)))
  return [channel(0), channel(1 / 3), channel(2 / 3)]
}

/** One frame: bands of hue sliding across, as an ImageSource of RGBA bytes in base64. */
export function hues(t: number) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const [red, green, blue] = rgb((x + y / 2 + t * 2) / WIDTH)
      pixels.set([red, green, blue, 255], (y * WIDTH + x) * 4)
    }
  }
  return { rgba: (pixels as Uint8Array & { toBase64: () => string }).toBase64(), width: WIDTH, height: HEIGHT }
}

function stop(): void {
  timer?.cancel()
  timer = null
}

async function paint($: Dollar): Promise<void> {
  frame += 1
  const painted = await $.ui.blit({ requestId: PANE, key: KEY, source: hues(frame) })
  // Refused: the pane was closed, or the terminal draws the alt text (inside tmux, say). Stop rather than ask again.
  if (painted.deny !== undefined) stop()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'image-mod', description: 'An Image repainted by $.ui.blit: /image-mod, /image-mod stop' })
    return next(e)
  })

  on('command.run', { command: 'image-mod' }, async ($, e) => {
    if (e.args.trim() === 'stop') {
      stop()
      return { text: 'Stopped.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'image-mod' })
    if (!opened.isPlaced) return { text: `The pane is waiting for room: ${opened.reason}` }
    timer ??= $.clock.every(FRAME_MS, () => void paint($).catch(stop))
    return { text: 'Hues sliding by, repainted ten times a second. /image-mod stop ends it.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>An Image is the terminal's alone.</Text>
    }
    const { Box, Image, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Image key={KEY} source={hues(frame)} columns={COLUMNS} rows={ROWS} alt="Bands of color sliding by. This terminal draws no pictures: kitty and Ghostty do, outside tmux." />
        <Text dimColor>Pixels made here as RGBA bytes, swapped by $.ui.blit with a new source each frame.</Text>
      </Box>
    )
  })
}
