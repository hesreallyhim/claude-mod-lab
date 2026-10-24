import { expect, test } from 'claude-code/testing'

import { desk } from './kit'

test('Claude hears back what the reminder is for and when it goes off', async ($, on) => {
  const { call } = desk($, on)

  const answer = await call({ minutes: 2, about: 'stretch' })

  expect(String(answer.result)).toContain('stretch')
  expect(String(answer.result)).toMatch(/2 minutes/)
})

test('a call with no minutes is refused, with the reason for Claude to put right', async ($, on) => {
  const { call } = desk($, on)

  const answer = await call({ about: 'stretch' })

  expect(String(answer.deny)).toContain('minutes')
})
