import { expect, test } from 'claude-code/testing'

import { openPane } from './kit'

test('the stopwatch starts at 0:00', async ($, on) => {
  const { reading } = await openPane($, on)

  expect(await reading()).toContain('0:00')
})

test('each press of +1 s adds a second', async ($, on) => {
  const { ui, reading } = await openPane($, on)

  await ui.press({ key: 'tick' })
  await ui.press({ key: 'tick' })

  expect(await reading()).toContain('0:02')
})
