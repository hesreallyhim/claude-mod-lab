import { expect, test } from 'claude-code/testing'

import { openPane } from './kit'

test('after Start, the stopwatch gains a second each second', async ($, on) => {
  const { ui, clock, reading } = await openPane($, on)

  await ui.press({ key: 'start' })
  await clock.advance(3_000)

  expect(await reading()).toMatch(/0:03\s+running/)
})

test('while it runs, the button says Stop', async ($, on) => {
  const { ui, startLabel } = await openPane($, on)

  await ui.press({ key: 'start' })

  expect(await startLabel()).toBe('Stop')
})
