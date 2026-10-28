import { expect, mock, test } from 'claude-code/testing'

import { lab, labStart } from './kit'

test('a step of session.start that fails is logged, and the steps after it run', async ($, on) => {
  mock.store(on)
  const reads: string[] = []
  on('state.get', ($, e, next) => {
    reads.push(e.key)
    return next(e)
  })
  const started = labStart($, on, { refuse: 'tool.register' })

  await started.start()

  expect(started.logged).toHaveLength(1)
  expect(started.logged[0]).toContain('refused-r1')
  expect(reads).toContain('isTracing')
  expect(reads).toContain('intercepts')
})

test('/mod-lab says the surfaces the session draws on', async ($, on) => {
  // A surface this build has no name for, so the line shows it as given.
  on('session.surfaces', () => ({ value: ['surface-z9' as never] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'room-w1' } }))
  await labStart($, on).start()

  const out = await $.command.run(lab(''))

  expect(out.text).toContain('mod-lab is running in surface-z9.')
})
