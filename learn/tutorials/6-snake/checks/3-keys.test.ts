import { expect, test } from 'claude-code/testing'

import { boardOf, cellsOf, click, pane, store } from './kit'

test('an arrow turns the snake', async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())

  const before = cellsOf(await boardOf(ui), '█')
  await click(ui)
  await ui.key({ key: 'up', in: 'board' })
  await ui.advance(150)
  const after = cellsOf(await boardOf(ui), '█')

  expect(Math.min(...after.map(([, y]) => y))).toBe(Math.min(...before.map(([, y]) => y)) - 1)
})

test('the arrow that would turn it back on itself is left alone', async ($, on) => {
  store(on)
  const ui = await $.ui.mount(pane())

  const before = cellsOf(await boardOf(ui), '█')
  await click(ui)
  await ui.key({ key: 'left', in: 'board' })
  await ui.advance(150)
  const after = cellsOf(await boardOf(ui), '█')

  expect(Math.max(...after.map(([x]) => x))).toBe(Math.max(...before.map(([x]) => x)) + 1)
})
