import { expect, mock, test } from 'claude-code/testing'

import { answerStart, HOUR_MS, screen, slash } from './kit'

test('reminders show while quiet is off', async ($, on) => {
  const clock = mock.clock(on)
  answerStart(on)
  const shown = screen(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(HOUR_MS)

  expect(shown.length).toBeGreaterThan(0)
})

test('no reminder reaches the screen while quiet is on', async ($, on) => {
  const clock = mock.clock(on)
  answerStart(on)
  const shown = screen(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.command.run(slash('quiet', 'on'))
  await clock.advance(HOUR_MS)

  expect(shown).toEqual([])
})

test('turning quiet off brings the reminders back', async ($, on) => {
  const clock = mock.clock(on)
  answerStart(on)
  const shown = screen(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.command.run(slash('quiet', 'on'))
  await clock.advance(HOUR_MS)
  await $.command.run(slash('quiet', 'off'))
  await clock.advance(HOUR_MS)

  expect(shown.length).toBeGreaterThan(0)
})
