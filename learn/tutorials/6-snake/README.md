# snake: a game in a Client

Everything a mod has drawn so far was drawn by a `ui.render` hook: the engine asks, the hook answers a tree, and anything that moves or reacts goes back through the hooks module. A `Client` is different. It is a region whose drawing is done by a module of the mod's own, a surface module, which runs on the drawing thread itself. It keeps state of its own, runs timers on the surface's frame clock, and hears the pointer and the keys directly, with no hook in between. When something should reach the rest of the mod, it posts.

You will build snake, a game played in a pane. The board is a surface module: the game's state, its clock, a click to start and the arrows to steer all stay on the drawing thread. When a game ends the board posts its score, and the hooks module keeps the best score in `$.store` and hands it back to the board.

```text
╭────────────────────────╮
│            ◆           │
│                        │
│  ███                   │
╰────────────────────────╯
score 0  best 3  click the board to start
```

## Before you start

This tutorial assumes [stopwatch-pane](../3-stopwatch-pane): a pane, `ui.render` and the elements of a surface. In a terminal of its own:

```sh
npx claude-mod-lab@alpha learn snake
```

You build the mod in `workshop/snake/`. The terminal and the desktop app draw a `Client`; VS Code and mobile do not. The checks mount the pane as a surface would and act on the board through the test kit's `Client` acts: `advance` moves the board's frame clock, `pointer` and `key` hand it a click and a key, and `post` posts as the board does.

## 1. A Client in a pane

Make the folder as in stopwatch, under the name snake.

`workshop/snake/.claude-plugin/plugin.json`

```json
{
  "name": "snake",
  "version": "0.1.0",
  "description": "A game of snake in a pane, played in a Client, the best score kept by the hooks module"
}
```

`workshop/snake/hooks/hooks.json`

```json
{ "modules": ["./register.tsx"] }
```

The hooks module opens the pane and draws the `Client` in it:

`workshop/snake/hooks/register.tsx`

```tsx
import type { Register } from 'claude-code'

const PANE = 'snake'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snake', description: 'A game of snake in a pane: click it, then the arrows' })
    return next(e)
  })

  on('command.run', { command: 'snake' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'snake' })
    return { text: opened.isPlaced ? 'Click the board to start; the arrows steer, and Escape gives the keys back.' : `The pane is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      return <Client key="board" module="./board.tsx" props={{ best: 0 }} />
    }
    const { Text } = $.ui.resolve(e)
    return <Text>The board is a Client, which only the terminal and the desktop app draw.</Text>
  })
}
```

`module` names the file that draws the board, as a quoted path relative to this file. The engine finds that file by reading the source when the mod loads, so the path has to be written out: with a variable there, the engine refuses to load the mod. `props` is plain data handed to the module; a new value on a later redraw reaches the running board, its state kept. `key` names the instance.

The board, a first version that draws a game that does not move yet:

`workshop/snake/hooks/board.tsx`

```tsx
import type { ClientModule } from 'claude-code'

type Cell = readonly [x: number, y: number]
type Heading = 'up' | 'down' | 'left' | 'right'
type Game = { snake: Cell[]; heading: Heading; food: Cell; score: number; isRunning: boolean; isOver: boolean; seed: number }

const COLUMNS = 24
const ROWS = 10

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

function rowsOf(game: Game): string[] {
  return Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLUMNS }, (_, x) => (isOn(game.snake, [x, y]) ? '█' : game.food[0] === x && game.food[1] === y ? '◆' : ' ')).join(''),
  )
}

const Board: ClientModule<{ best: number }, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const game = newGame()
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" flexDirection="column" width={COLUMNS + 2}>
        {rowsOf(game).map((row, y) => (
          <Text key={`row:${y}`} mono>{row}</Text>
        ))}
      </Box>
      <Text>{`score ${game.score}  best ${props.best}`}</Text>
    </Box>
  )
}

export default Board
```

A surface module exports one function, from its props and its surface to a tree. It has no `$`: it does not run in the hooks module's environment, and nothing it does is an event. Its elements come from `surface.elements`, the terminal's table without `Client` (none nests), `Raster` or `Image`. The function runs again whenever the board is to be drawn again, so it should be quick: a second per call at most, or the instance is unmounted.

Each row is a `Text` with `mono`, the surface's monospaced face. In the terminal every character already has the same width, so it changes nothing there, but the desktop app draws text in a proportional face unless asked, and there a space is narrower than a `█`: the snake would creep to the right at a fraction of its speed and hit the wall halfway across.

## 2. A click and a clock

The board's game should live as long as the board does. `surface.state` is the instance's own: `undefined` until the first `surface.setState`, then kept across every call and every redraw the hooks module makes, and dropped with the instance. Set it up on the first call, with the clock and the pointer, and draw from it on the calls after:

```tsx
const TICK_MS = 150
const MOVES: Record<Heading, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** One tick: the head moves a cell, the body follows. */
export function step(game: Game): Game {
  const [hx, hy] = game.snake[0] ?? [0, 0]
  const [dx, dy] = MOVES[game.heading]
  const head: Cell = [hx + dx, hy + dy]
  return { ...game, snake: [head, ...game.snake.slice(0, -1)] }
}

/** A click starts the game. */
export function onClick(game: Game): Game {
  return { ...game, isRunning: true }
}
```

```tsx
const Board: ClientModule<{ best: number }, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const game = surface.state
  if (game === undefined) {
    // The first call: the game, its clock and its pointer are set up once, here.
    surface.setState(newGame())
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now === undefined || !now.isRunning || now.isOver) return
      surface.setState(step(now))
    })
    surface.onPointer(event => {
      if (event.type === 'down' && surface.state !== undefined) surface.setState(onClick(surface.state))
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
      <Text>{`score ${game.score}  best ${props.best}`}</Text>
    </Box>
  )
}
```

`setState` replaces the state and asks for one more call on the next frame. `every` keeps calling back, timed by the surface's frames, until the instance is gone, so the board starts it only on the first call, when `state` is still undefined; starting it on every call would add one more timer each time. A `setState` on each of three calls in a row, with nothing in between (no tick, key, click or new props), is a render loop, and the instance is unmounted for it.

The pointer reaches `onPointer` in the region's own cells. A click there also gives the board the keys, which the next step uses. None of this involves the hooks module: the game runs at the surface's pace with no event raised.

## 3. The keys

`onKey` hears each key while the board has the focus; a click gave it, and Escape gives it back. Steer with the arrows, never straight back:

```tsx
const OPPOSITE: Record<Heading, Heading> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** An arrow turns the snake, though never back on itself. */
export function onKey(game: Game, event: ClientKeyEvent): Game {
  const heading = event.key as Heading
  if (!(heading in MOVES) || heading === OPPOSITE[game.heading]) return game
  return { ...game, heading }
}
```

with `ClientKeyEvent` imported beside `ClientModule`, and, on the first call:

```tsx
    surface.onKey(event => {
      if (surface.state !== undefined) surface.setState(onKey(surface.state, event))
    })
```

## 4. Food and the end

A tick that lands on the food grows the snake by a cell and scores; one that lands on a wall or on its body ends the game. Replace `step`:

```tsx
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
```

The tail's cell is left out of the body it may not land on, since the tail moves away on the same tick. A click on a finished game starts a new one:

```tsx
/** A click starts the game, or a new one once it is over. */
export function onClick(game: Game): Game {
  return game.isOver ? { ...newGame(game.seed), isRunning: true } : { ...game, isRunning: true }
}
```

and the line under the board says where the game stands:

```tsx
      <Text>{`score ${game.score}  best ${Math.max(props.best, game.score)}  ${game.isOver ? 'game over: click to play again' : game.isRunning ? 'the arrows steer' : 'click the board to start'}`}</Text>
```

## 5. A score for the hooks module

The best score should outlast the board, and the session too. The board cannot keep it: its state goes with the instance, and it has no `$` to reach `$.store`. When a game ends it posts the score, in the clock's callback:

```tsx
      const moved = step(now)
      surface.setState(moved)
      if (moved.isOver) surface.post({ score: moved.score })
```

`post` passes a JSON-like value from the board back to the mod's hooks module, where it arrives as a `ui.message` event that no other plugin's hooks receive. There the best is kept, and handed straight back:

```tsx
  // A game ended: the board posts its score. The best is kept in $.store, which
  // outlasts the session, and handed back to the board as props, with no redraw.
  on('ui.message', { element: 'board' }, async ($, e) => {
    const { score } = e.data as { score?: unknown }
    const best = Math.max(Number((await $.store.get('best')) ?? 0), typeof score === 'number' ? score : 0)
    await $.store.set('best', best)
    return { props: { best } }
  })
```

and the render hook reads it for the board's props:

```tsx
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const best = Number((await $.store.get('best')) ?? 0)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      return <Client key="board" module="./board.tsx" props={{ best }} />
    }
```

A `ui.message` hook that answers `{ props }` hands the posting board its next props directly: no `ui.render` runs, and the board's state is kept. The data came from code on the drawing thread, so the hook checks its shape before trusting it, and `e.data` is typed `unknown` for that reason.

## 6. Play it

```sh
npx claude-mod-lab@alpha run
```

`/snake` opens the pane. Click the board: the game starts, and the board has the keys. Steer with the arrows; Escape gives the keys back to the prompt. When the game ends, the best score under the board is the hooks module's, and it is there again in the next session, from `$.store`. Save a change to `board.tsx` while the pane is open: the board loads again, its state gone.

Then try it in the desktop app, with the folder named in `CLAUDE_CODE_PLUGIN_DIRS` as [docs/desktop.md](../../../docs/desktop.md) describes: `/snake` there runs the same surface module, drawn with the desktop's elements.

<details>
<summary>Once it works: what crosses, and what stays</summary>

Two modules make the mod, and each runs where it is needed. The hooks module runs in the engine, with `$`: it opens the pane, decides what the `Client` gets, and keeps what should last. The surface module runs on the drawing thread: everything that happens at the pace of a frame or a key stays there, and costs no event. Between them pass two kinds of plain data, both bounded: `props` from the hooks module to the board (with the `Client`, or as a `ui.message` answer), and `post` from the board to the hooks module. No closures cross, and no `$`.

That split is what makes a `Client` the place for anything interactive at speed: a game, a sketchpad, a scrubber over a timeline. A `ui.render` hook could draw the same board, but every tick and every key would be a press, a state write and a redraw through the engine.

</details>
