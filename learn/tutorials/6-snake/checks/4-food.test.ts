import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { boardOf, cellsOf, click, pane, store } from './kit'

/** Steers the head onto the food: across to its column, then up or down to its row. */
async function eat(ui: Mounted<'terminal', 'Pane'>): Promise<void> {
  const rows = await boardOf(ui)
  const [food] = cellsOf(rows, '◆')
  const head = Math.max(...cellsOf(rows, '█').map(([x]) => x))
  const row = cellsOf(rows, '█')[0]?.[1] ?? 0
  if (food === undefined) throw new Error(`no food on the board:\n${rows.join('\n')}`)
  await click(ui)
  await ui.advance(150 * (food[0] - head))
  await ui.key({ key: food[1] < row ? 'up' : 'down', in: 'board' })
  await ui.advance(150 * Math.abs(food[1] - row))
}

test('the snake that reaches the food grows by a cell and scores', async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())
  const length = cellsOf(await boardOf(ui), '█').length

  await eat(ui)
  const rows = await boardOf(ui)

  expect(cellsOf(rows, '█').length).toBe(length + 1)
  expect(rows.some(row => row.includes('score 1'))).toBe(true)
})

test('a wall ends the game, says so, and the snake stops; a click plays again', async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())

  await click(ui)
  await ui.advance(150 * 30)
  const over = await boardOf(ui)
  await ui.advance(600)

  expect(over.some(row => row.includes('game over'))).toBe(true)
  expect(await boardOf(ui)).toEqual(over)
  await click(ui)
  expect((await boardOf(ui)).some(row => row.includes('game over'))).toBe(false)
})
