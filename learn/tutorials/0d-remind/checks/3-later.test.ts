import { expect, test } from 'claude-code/testing'

import { desk } from './kit'

test('a reminder Claude sets goes off once its minutes have passed, and not before', async ($, on) => {
  const { clock, call, said } = desk($, on)
  await call({ minutes: 2, about: 'stretch' })

  await clock.advance(119_000)
  expect(said).toEqual([])

  await clock.advance(1_000)
  expect(said).toEqual(['Reminder: stretch'])
})

test('/remind 0.5 drink water goes off after thirty seconds', async ($, on) => {
  const { clock, slash, said } = desk($, on)
  await slash('0.5 drink water')

  await clock.advance(30_000)

  expect(said).toEqual(['Reminder: drink water'])
})
