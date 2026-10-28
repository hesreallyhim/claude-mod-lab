// The identity's drawings, as terminal cells. Every piece of the brand is laid
// out on one grid: a cell is one lit or unlit square, and nothing is drawn off
// it. The name is set in a 5×7 bitmap face on a 6-cell advance, the face of a
// character LCD or a VT terminal; the mark is the shell prompt `$` followed by
// a cursor drawn as a flask. The icon is that mark alone on a 16×16 grid, so at
// 16px each cell is one pixel and at 32px two.
//
// In the art, `#` is a lit cell and `.` an unlit one; in the flask, `g` is the
// glass and `l` the liquid, so the two can take different colours.

const GLYPHS = {
  c: ['.....', '.....', '.###.', '#....', '#....', '#...#', '.###.'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  d: ['....#', '....#', '.##.#', '#..##', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  m: ['.....', '.....', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  b: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '####.'],
  '-': ['.....', '.....', '.....', '.....', '.###.', '.....', '.....'],
}

/** The prompt: a narrow `$`, as tall as the name's ascenders. */
const PROMPT = ['.#.', '###', '#..', '###', '..#', '###', '.#.']

/** The cursor, drawn as a flask: 9 cells wide, 12 tall, its base on the name's baseline. */
const FLASK = [
  '..ggggg..',
  '..g...g..',
  '..g...g..',
  '..g...g..',
  '.g.....g.',
  'g.......g',
  'g.......g',
  'glllllllg',
  'glllllllg',
  'glllllllg',
  'glllllllg',
  '.ggggggg.',
]

export const NAME = 'claude-mod-lab'
export const ADVANCE = 6
const TEXT_ROWS = 7
const FLASK_RISE = FLASK.length - TEXT_ROWS

/** Cells of a bitmap at (x, y), each tagged with a role taken from its character. */
function place(rows, x, y, role) {
  const cells = []
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch === '.') return
      cells.push({ x: x + dx, y: y + dy, role: ch === 'g' ? 'glass' : ch === 'l' ? 'liquid' : role })
    }),
  )
  return cells
}

/** The name in the bitmap face, its ascender line at y. */
export function word(text, x, y, role = 'name') {
  return [...text].flatMap((ch, i) => place(GLYPHS[ch], x + i * ADVANCE, y, role))
}

/**
 * The lockup `$ claude-mod-lab` with the flask as its cursor: 100 cells wide
 * and 12 tall. The flask stands 5 cells above the name; the name's ascender line
 * is at row 5. Returns the cells, and where the flask's top-left cell and its
 * neck are, for bubbles.
 */
export function lockup(x = 0, y = 0) {
  const top = y + FLASK_RISE
  const nameX = x + 6
  const flaskX = nameX + NAME.length * ADVANCE - 1 + 2
  return {
    cells: [...place(PROMPT, x, top, 'prompt'), ...word(NAME, nameX, top), ...place(FLASK, flaskX, y)],
    width: flaskX + FLASK[0].length - x,
    height: FLASK.length,
    nameX,
    flask: { x: flaskX, y },
    neck: { x: flaskX + 4, y },
  }
}

/** The icon: the prompt and the flask cursor alone, on 16×16, sharing the name's baseline at row 13. */
export function icon() {
  return [...place(PROMPT, 1, 7, 'prompt'), ...place(FLASK, 6, 2)]
}

/** Bubbles in a flask's liquid: unlit cells, for a still drawing of the flask whose top-left cell is `flask`. */
export function fizz(flask, offsets = [[3, 9], [5, 8]]) {
  return offsets.map(([dx, dy]) => ({ x: flask.x + dx, y: flask.y + dy, role: 'fizz' }))
}

/** Rising bubbles above a flask's neck: single cells drifting up and to the side. */
export function bubbles(neck, offsets = [[0, -2], [1, -4], [-1, -6], [1, -8]]) {
  return offsets.map(([dx, dy]) => ({ x: neck.x + dx, y: neck.y + dy, role: 'bubble' }))
}

/** Merges runs of same-role cells in a row into one rect each, to keep the SVGs small. */
export function runs(cells) {
  const byRow = new Map()
  for (const c of cells) {
    const key = `${c.y}:${c.role}`
    if (!byRow.has(key)) byRow.set(key, [])
    byRow.get(key).push(c.x)
  }
  const out = []
  for (const [key, xs] of byRow) {
    const [y, role] = key.split(':')
    xs.sort((a, b) => a - b)
    let start = xs[0]
    for (let i = 1; i <= xs.length; i++) {
      if (xs[i] !== xs[i - 1] + 1) {
        out.push({ x: start, y: Number(y), w: xs[i - 1] - start + 1, role })
        start = xs[i]
      }
    }
  }
  return out
}
