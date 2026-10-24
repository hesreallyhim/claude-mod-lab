import { expect, test } from 'claude-code/testing'

import { desk } from './kit'

test('when the reminder goes off, Claude is told what it is about', async ($, on) => {
  const { clock, call, prompts } = desk($, on)
  await call({ minutes: 2, about: 'stretch' })

  await clock.advance(119_000)
  expect(prompts).toEqual([])

  await clock.advance(1_000)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('stretch')
})
