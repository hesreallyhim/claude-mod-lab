import { expect, test } from 'claude-code/testing'

import { answerStart } from './kit'

test('the tool is registered as total when the session starts', async ($, on) => {
  const registered = answerStart(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(registered.map(spec => spec.name)).toContain('total')
})

test('the model sees the tool from the start, not behind a search', async ($, on) => {
  const registered = answerStart(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(registered.find(spec => spec.name === 'total')?.isDeferred).toBe(false)
})
