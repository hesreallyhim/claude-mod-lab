// raster-mod: a Raster in a pane, repainted by $.ui.blit with no render pass.
// One of the gallery's techniques as a mod of its own; templates/README.md
// says where the rest are.

import type { EngineInterface, Register, Timer } from 'claude-code'

type Dollar = EngineInterface

const PANE = 'raster-mod'
const KEY = 'wave'
const COLUMNS = 48
const ROWS = 8
const FRAME_MS = 100
const BLOCK = 0x2588
const SPACE = 0x20
const LIT = 0x7aa2f7
// Bit 24 alone: the terminal's own default color.
const DEFAULT = 0x01000000

// The animation lives in module variables: a reload stops its timer, so state saying it plays would be wrong.
let timer: Timer | null = null
let frame = 0

/** One frame of a wave, as RasterProps' cells: little-endian u32 triplets [code point, foreground, background], base64. */
export function waveCells(t: number): string {
  const words = new Uint32Array(COLUMNS * ROWS * 3)
  for (let x = 0; x < COLUMNS; x += 1) {
    const height = Math.round(((Math.sin(x / 4 + t / 3) + 1) / 2) * ROWS)
    for (let y = 0; y < ROWS; y += 1) {
      const index = (y * COLUMNS + x) * 3
      const isLit = ROWS - y <= height
      words[index] = isLit ? BLOCK : SPACE
      words[index + 1] = isLit ? LIT : DEFAULT
      words[index + 2] = DEFAULT
    }
  }
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
}

function stop(): void {
  timer?.cancel()
  timer = null
}

async function paint($: Dollar): Promise<void> {
  frame += 1
  const painted = await $.ui.blit({ requestId: PANE, key: KEY, cells: waveCells(frame) })
  // Refused: the pane was closed, or drawn again at another size. Stop rather than ask again.
  if (painted.deny !== undefined) stop()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'raster-mod', description: 'A Raster repainted by $.ui.blit: /raster-mod, /raster-mod stop' })
    return next(e)
  })

  on('command.run', { command: 'raster-mod' }, async ($, e) => {
    if (e.args.trim() === 'stop') {
      stop()
      return { text: 'Stopped.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'raster-mod' })
    if (!opened.isPlaced) return { text: `The pane is waiting for room: ${opened.reason}` }
    timer ??= $.clock.every(FRAME_MS, () => void paint($).catch(stop))
    return { text: 'A wave, repainted ten times a second. /raster-mod stop ends it.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>A Raster is the terminal's alone.</Text>
    }
    const { Box, Raster, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Raster key={KEY} columns={COLUMNS} rows={ROWS} cells={waveCells(frame)} />
        <Text dimColor>Each frame is one $.ui.blit with new cells; this render hook does not run for it.</Text>
      </Box>
    )
  })
}
