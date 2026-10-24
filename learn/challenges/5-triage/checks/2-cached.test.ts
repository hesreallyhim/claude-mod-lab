import { expect, test } from 'claude-code/testing'

import { cachedPart, contextSent, model, replying, typed } from './kit'

test('each request opens with the same guide, marked for the cache, and the prompt after it', async ($, on) => {
  const sent = model(on, () => replying('feature'))
  contextSent(on)

  await $.prompt.submit(typed('Add a dark theme to the settings page.'))
  await $.prompt.submit(typed('Why is the parser recursive?'))

  const [first, second] = sent.map(cachedPart)
  expect(first?.marked).toBeDefined()
  expect(second?.marked?.text).toBe(first?.marked?.text)
  expect(first?.marked?.text).not.toContain('dark theme')
  expect(first?.after).toContain('Add a dark theme to the settings page.')
  expect(second?.after).toContain('Why is the parser recursive?')
})

test('the label is asked of a small model, with room for a word and no more', async ($, on) => {
  const sent = model(on, () => replying('question'))
  contextSent(on)

  await $.prompt.submit(typed('Where is the retry limit set?'))

  expect(sent[0]?.model.toLowerCase()).toContain('haiku')
  expect(sent[0]?.maxTokens).toBeLessThanOrEqual(16)
})
