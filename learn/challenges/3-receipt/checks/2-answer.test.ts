import { expect, test } from 'claude-code/testing'

import { TOOL } from './kit'

const ITEMS = [
  { name: 'tea', price: 2.5, quantity: 5 },
  { name: 'scones', price: 1.25, quantity: 4 },
]

test('a call is answered by the mod with text that gives the total to two decimal places', async $ => {
  const answer = await $.tool.call({ tool: TOOL, items: ITEMS })
  const result = 'result' in answer ? answer.result : undefined

  // A session refuses a registered tool's answer that is not a string; the test kit lets one through.
  expect(typeof result).toBe('string')
  expect(String(result)).toContain('17.50')
})
