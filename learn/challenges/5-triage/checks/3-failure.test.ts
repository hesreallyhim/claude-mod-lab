import { expect, test } from 'claude-code/testing'

import { contextSent, model, typed } from './kit'

test('a call the model does not answer leaves the prompt as it was', async ($, on) => {
  model(on, () => ({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  const context = contextSent(on)

  await $.prompt.submit(typed('The build is red.'))

  expect(context).toHaveLength(1)
  expect(context[0]?.filter(line => line.startsWith('triage:'))).toEqual([])
})

test('a call that is refused leaves the prompt as it was', async ($, on) => {
  model(on, () => ({ deny: 'the model is not allowed here' }))
  const context = contextSent(on)

  await $.prompt.submit(typed('The build is red.'))

  expect(context).toHaveLength(1)
  expect(context[0]?.filter(line => line.startsWith('triage:'))).toEqual([])
})

test('the call is given a time limit, so a slow model cannot hold the prompt', async ($, on) => {
  const sent = model(on, () => ({ value: { isAnswered: true, text: 'bug', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  contextSent(on)

  await $.prompt.submit(typed('The build is red.'))

  expect(sent[0]?.timeoutMs).toBeGreaterThan(0)
  expect(sent[0]?.timeoutMs).toBeLessThanOrEqual(10_000)
})
