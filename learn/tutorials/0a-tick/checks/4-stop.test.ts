import { expect, test } from 'claude-code/testing'

import { openPane } from './kit'

test('Stop holds the time where it was', async ($, on) => {
  const { ui, clock, reading } = await openPane($, on)
  await ui.press({ key: 'start' })
  await clock.advance(2_000)

  await ui.press({ key: 'start' })
  await clock.advance(5_000)

  expect(await reading()).toMatch(/0:02\s+stopped/)
})

test('Start again carries on from there', async ($, on) => {
  const { ui, clock, reading } = await openPane($, on)
  await ui.press({ key: 'start' })
  await clock.advance(2_000)
  await ui.press({ key: 'start' })

  await ui.press({ key: 'start' })
  await clock.advance(1_000)

  expect(await reading()).toMatch(/0:03\s+running/)
})
