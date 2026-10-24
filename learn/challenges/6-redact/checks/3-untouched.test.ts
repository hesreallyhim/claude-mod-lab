import { expect, test } from 'claude-code/testing'

import { conversation, row } from './kit'

test('a row without a key is stored exactly as it came', async ($, on) => {
  const stored = conversation(on)
  const content = [
    { type: 'text', text: 'sk- is how the keys begin, and AKIA too; this one is too short: sk-abc' },
    { type: 'tool_result', tool_use_id: 'toolu_u1', content: [{ type: 'text', text: 'ghp_ alone is no key' }], is_error: false },
  ]

  await $.session.append(row('tool-result', content))

  expect(stored()[0]?.content).toEqual(content)
})

test('every row is stored: none is refused, none emptied', async ($, on) => {
  const stored = conversation(on)

  await $.session.append(row('prompt', [{ type: 'text', text: 'one' }]))
  await $.session.append(row('response', [{ type: 'text', text: 'two' }], 'assistant'))

  expect(stored()).toHaveLength(2)
})
