// The board: a surface module. It runs on the drawing thread, inside the
// Client the hooks module draws, with no $: its game is its own state, its
// clock, pointer and keys are the surface's, and a score goes back by post.

import type { ClientKeyEvent, ClientModule } from 'claude-code'

type Cell = readonly [x: number, y: number]
type Heading = 'up' | 'down' | 'left' | 'right'
type Game = { snake: Cell[]; heading: Heading; food: Cell; score: number; isRunning: boolean; isOver: boolean; seed: number }

const COLUMNS = 24
const ROWS = 10
const TICK_MS = 150
const MOVES: Record<Heading, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const OPPOSITE: Record<Heading, Heading> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** The next seed and a number from 0 below `n`: the same food for the same game, so a test can count on it. */
function random(seed: number, n: number): [number, number] {
  const next = (seed * 1103515245 + 12345) % 2147483648
  return [next, next % n]
}

function isOn(cells: readonly Cell[], [x, y]: Cell): boolean {
  return cells.some(([cx, cy]) => cx === x && cy === y)
}

function placeFood(snake: readonly Cell[], seed: number): { food: Cell; seed: number } {
  let state = seed
  for (;;) {
    const [afterX, x] = random(state, COLUMNS)
    const [afterY, y] = random(afterX, ROWS)
    state = afterY
    if (!isOn(snake, [x, y])) return { food: [x, y], seed: state }
  }
}

export function newGame(seed = 7): Game {
  const snake: Cell[] = [[4, 4], [3, 4], [2, 4]]
  return { snake, heading: 'right', score: 0, isRunning: false, isOver: false, ...placeFood(snake, seed) }
}

/** One tick: the head moves a cell; the snake grows on food, and the game ends at a wall or its own body. */
export function step(game: Game): Game {
  const [hx, hy] = game.snake[0] ?? [0, 0]
  const [dx, dy] = MOVES[game.heading]
  const head: Cell = [hx + dx, hy + dy]
  const isWall = head[0] < 0 || head[0] >= COLUMNS || head[1] < 0 || head[1] >= ROWS
  if (isWall || isOn(game.snake.slice(0, -1), head)) return { ...game, isOver: true }
  if (head[0] === game.food[0] && head[1] === game.food[1]) {
    const snake = [head, ...game.snake]
    return { ...game, snake, score: game.score + 1, ...placeFood(snake, game.seed) }
  }
  return { ...game, snake: [head, ...game.snake.slice(0, -1)] }
}

/** A click starts the game, or a new one once it is over. */
export function onClick(game: Game): Game {
  return game.isOver ? { ...newGame(game.seed), isRunning: true } : { ...game, isRunning: true }
}

/** An arrow turns the snake, though never back on itself. */
export function onKey(game: Game, event: ClientKeyEvent): Game {
  const heading = event.key as Heading
  if (!(heading in MOVES) || heading === OPPOSITE[game.heading]) return game
  return { ...game, heading }
}

function rowsOf(game: Game): string[] {
  return Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLUMNS }, (_, x) => (isOn(game.snake, [x, y]) ? '█' : game.food[0] === x && game.food[1] === y ? '◆' : ' ')).join(''),
  )
}

const Board: ClientModule<{ best: number }, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const game = surface.state
  if (game === undefined) {
    // The first call: the game, its clock, its pointer and its keys are set up once, here.
    surface.setState(newGame())
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now === undefined || !now.isRunning || now.isOver) return
      const moved = step(now)
      surface.setState(moved)
      if (moved.isOver) surface.post({ score: moved.score })
    })
    surface.onPointer(event => {
      if (event.type === 'down' && surface.state !== undefined) surface.setState(onClick(surface.state))
    })
    surface.onKey(event => {
      if (surface.state !== undefined) surface.setState(onKey(surface.state, event))
    })
    return <Text>…</Text>
  }
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" flexDirection="column" width={COLUMNS + 2}>
        {rowsOf(game).map((row, y) => (
          <Text key={`row:${y}`} mono>{row}</Text>
        ))}
      </Box>
      <Text>{`score ${game.score}  best ${Math.max(props.best, game.score)}  ${game.isOver ? 'game over: click to play again' : game.isRunning ? 'the arrows steer' : 'click the board to start'}`}</Text>
    </Box>
  )
}

export default Board
