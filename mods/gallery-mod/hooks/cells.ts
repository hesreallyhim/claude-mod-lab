// Cell grids for Raster: the packing RasterProps describes, a Game of Life
// drawn with half blocks, and a heat map of tool calls by minute.

/** A cell's color is 0x00RRGGBB, or this for the terminal's own. */
export const DEFAULT_COLOR = 0x01000000

const UPPER_HALF = 0x2580
const FULL_BLOCK = 0x2588
const MIDDLE_DOT = 0x00b7

/** One cell: a printable width-1 code point, a foreground and a background. */
export type Cell = readonly [codePoint: number, foreground: number, background: number]

/** Base64 of bytes; the engine's runtime has Uint8Array.prototype.toBase64. */
export function base64(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64: () => string }).toBase64()
}

/** Packs cells, row-major, as RasterProps' `cells`: little-endian u32 triplets, base64. */
export function encodeCells(cells: readonly Cell[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach(([codePoint, foreground, background], index) => {
    words[index * 3] = codePoint
    words[index * 3 + 1] = foreground
    words[index * 3 + 2] = background
  })
  return base64(new Uint8Array(words.buffer))
}

/** A Game of Life grid; `age` counts the generations a live cell has lived, 0 for a dead one. */
export type Life = { width: number; height: number; age: Uint8Array }

/** A seeded grid, the same for the same seed, about a third of it alive. */
export function seedLife(width: number, height: number, seed = 7): Life {
  let state = seed >>> 0 || 1
  const age = new Uint8Array(width * height)
  for (let index = 0; index < age.length; index += 1) {
    // xorshift32: a fixed sequence, so a test and a session start alike.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    age[index] = (state >>> 0) % 3 === 0 ? 1 : 0
  }
  return { width, height, age }
}

/** The next generation, the grid wrapping at its edges. */
export function stepLife(life: Life): Life {
  const { width, height, age } = life
  const next = new Uint8Array(age.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let neighbors = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = (x + dx + width) % width
          const ny = (y + dy + height) % height
          if (age[ny * width + nx] !== 0) neighbors += 1
        }
      }
      const index = y * width + x
      const alive = age[index] !== 0
      if (alive && (neighbors === 2 || neighbors === 3)) next[index] = Math.min((age[index] ?? 0) + 1, 255)
      else if (!alive && neighbors === 3) next[index] = 1
    }
  }
  return { width, height, age: next }
}

/** A newborn cell is bright and an old one fades toward a dim blue. */
function ageColor(age: number): number {
  if (age === 0) return DEFAULT_COLOR
  const fade = Math.min(age - 1, 12) / 12
  const red = Math.round(0xff - fade * 0xc0)
  const green = Math.round(0xd0 - fade * 0x90)
  const blue = Math.round(0x40 + fade * 0x90)
  return (red << 16) | (green << 8) | blue
}

/**
 * Two grid rows to one row of cells: an upper half block whose foreground is
 * the upper cell and whose background is the lower, so a Raster `rows` tall
 * shows a grid twice that.
 */
export function lifeCells(life: Life): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < life.height; y += 2) {
    for (let x = 0; x < life.width; x += 1) {
      const upper = life.age[y * life.width + x] ?? 0
      const lower = y + 1 < life.height ? (life.age[(y + 1) * life.width + x] ?? 0) : 0
      cells.push([UPPER_HALF, ageColor(upper), ageColor(lower)])
    }
  }
  return cells
}

/** Counts per tool and minute: `counts[row][column]`, the newest minute last. */
export type Heat = { tools: string[]; counts: number[][] }

/** The `rows` busiest tools over the last `minutes` minutes before `now`. */
export function heatOf(calls: readonly { at: number; tool: string }[], now: number, minutes: number, rows: number): Heat {
  const start = now - minutes * 60_000
  const recent = calls.filter(call => call.at > start && call.at <= now)
  const totals = new Map<string, number>()
  for (const call of recent) totals.set(call.tool, (totals.get(call.tool) ?? 0) + 1)
  const tools = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, rows)
    .map(([tool]) => tool)
  const counts = tools.map(() => new Array<number>(minutes).fill(0))
  for (const call of recent) {
    const row = counts[tools.indexOf(call.tool)]
    const column = Math.min(minutes - 1, Math.floor((call.at - start) / 60_000))
    if (row !== undefined) row[column] = (row[column] ?? 0) + 1
  }
  return { tools, counts }
}

/** Dark blue for one call in a minute, through orange, to a pale yellow for the busiest. */
function heatColor(count: number, most: number): number {
  const level = most <= 1 ? 1 : (count - 1) / (most - 1)
  const red = Math.round(0x30 + level * 0xcf)
  const green = Math.round(0x40 + level * 0xa0)
  const blue = Math.round(0xa0 - level * 0x60)
  return (red << 16) | (green << 8) | blue
}

/** One row of cells per tool: a block colored by the minute's count, a dim dot for none. */
export function heatCells(heat: Heat): Cell[] {
  const most = Math.max(1, ...heat.counts.flat())
  return heat.counts.flatMap(row =>
    row.map((count): Cell => (count === 0 ? [MIDDLE_DOT, 0x505050, DEFAULT_COLOR] : [FULL_BLOCK, heatColor(count, most), DEFAULT_COLOR])),
  )
}
