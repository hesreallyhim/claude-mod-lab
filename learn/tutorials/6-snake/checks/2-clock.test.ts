import { expect, test } from 'claude-code/testing'

import { boardOf, cellsOf, click, pane, store } from './kit'

const rightmost = (cells: [number, number][]) => Math.max(...cells.map(([x]) => x))

test('the snake waits for a click on the board', async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())

  const before = await boardOf(ui)
  await ui.advance(600)

  expect(await boardOf(ui)).toEqual(before)
})

test("after the click, the board's own clock moves the snake a cell a tick, to the right at first", async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())

  const before = cellsOf(await boardOf(ui), '█')
  await click(ui)
  await ui.advance(150)
  const once = cellsOf(await boardOf(ui), '█')
  await ui.advance(450)
  const later = cellsOf(await boardOf(ui), '█')

  expect(once.length).toBe(before.length)
  expect(rightmost(once)).toBe(rightmost(before) + 1)
  expect(rightmost(later)).toBe(rightmost(before) + 4)
})
