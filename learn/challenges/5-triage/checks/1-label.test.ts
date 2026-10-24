import { expect, test } from 'claude-code/testing'

import { contextSent, model, replying, typed } from './kit'

test('the main model reads the label as one line, triage: and the label in lowercase', async ($, on) => {
  model(on, () => replying(' Bug.\n'))
  const context = contextSent(on)

  await $.prompt.submit(typed('The export drops the last row since the update.'))

  expect(context[0]).toContain('triage: bug')
})

test('a reply that is none of the labels adds nothing for the main model to read', async ($, on) => {
  model(on, () => replying('Hard to say: it reads like a bug, or a request for one.'))
  const context = contextSent(on)

  await $.prompt.submit(typed('The export, hm.'))

  expect(context[0]?.filter(line => line.startsWith('triage:'))).toEqual([])
})
