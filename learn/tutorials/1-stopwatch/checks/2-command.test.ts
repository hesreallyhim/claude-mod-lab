import { expect, test } from 'claude-code/testing'

import { answerStart, slash } from './kit'

test('the mod registers /stopwatch when the session starts', async ($, on) => {
  const registered = answerStart(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(registered).toContain('stopwatch')
})

test('/stopwatch answers with a line of text', async $ => {
  const answer = await $.command.run(slash('stopwatch'))

  expect(typeof answer.text).toBe('string')
  expect(answer.text?.trim()).not.toBe('')
})
