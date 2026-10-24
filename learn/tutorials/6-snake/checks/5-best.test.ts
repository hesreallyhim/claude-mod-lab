import { expect, test } from 'claude-code/testing'

import { boardOf, click, pane, store } from './kit'

test('a game that ends posts its score; the hooks module keeps the best in $.store and hands it to the board', async ($, on) => {
  const kept = store(on)
  const ui = await $.ui.mount(pane())

  await ui.post({ score: 4 })
  const rows = await boardOf(ui)

  expect(kept.get('best')).toBe(4)
  expect(rows.some(row => row.includes('best 4'))).toBe(true)
})

test('a lower score leaves the best as it was', async ($, on) => {
  const kept = store(on, { best: 9 })
  const ui = await $.ui.mount(pane())

  await ui.post({ score: 2 })

  expect(kept.get('best')).toBe(9)
  expect((await boardOf(ui)).some(row => row.includes('best 9'))).toBe(true)
})

test('the board posts when its game ends, and the best shows from then on', async ($, on) => {
  const kept = store(on)
  const ui = await $.ui.mount(pane())

  await click(ui)
  await ui.advance(150 * 30)

  expect(kept.get('best')).toBe(0)
  expect((await boardOf(ui)).some(row => row.includes('game over'))).toBe(true)
})
