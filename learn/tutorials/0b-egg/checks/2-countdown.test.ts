import { expect, test } from 'claude-code/testing'

import { kitchen } from './kit'

test('the band counts down as time passes', async ($, on) => {
  const { clock, egg, shown } = kitchen($, on)
  await egg()
  expect(await shown()).toContain('3:00 left')

  await clock.advance(60_000)

  expect(await shown()).toContain('2:00 left')
})

test('when the time is up, the band says ready', async ($, on) => {
  const { clock, egg, shown } = kitchen($, on)
  await egg()

  await clock.advance(180_000)

  expect(await shown()).toContain('ready')
})
