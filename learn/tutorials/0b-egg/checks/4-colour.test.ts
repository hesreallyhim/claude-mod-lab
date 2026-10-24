import { expect, test } from 'claude-code/testing'

import { kitchen } from './kit'

test('the bar starts green', async ($, on) => {
  const { egg, barColor } = kitchen($, on)

  await egg()

  expect(await barColor()).toBe('success')
})

test('with less than half the time left, it turns yellow', async ($, on) => {
  const { clock, egg, barColor } = kitchen($, on)
  await egg()

  await clock.advance(100_000)

  expect(await barColor()).toBe('warning')
})

test('with less than a fifth left, it turns red', async ($, on) => {
  const { clock, egg, barColor } = kitchen($, on)
  await egg()

  await clock.advance(150_000)

  expect(await barColor()).toBe('error')
})
