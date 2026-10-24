import { expect, test } from 'claude-code/testing'

import { recordStatus, runTools, slash } from './kit'

test('the totals are written to $.state under stopwatch.totals', async ($, on) => {
  const tools = runTools($, on)
  recordStatus(on)
  const written: unknown[] = []
  on('state.set', { plugin: 'stopwatch', key: 'totals' }, ($, e, next) => {
    written.push(e.value)
    return next(e)
  })

  await tools.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, 610)
  await tools.call({ tool: 'Bash', command: 'make test' }, 2_870)

  expect(written.at(-1)).toEqual({ Edit: { calls: 1, ms: 610 }, Bash: { calls: 1, ms: 2_870 } })
})

test('/stopwatch reports the totals held in $.state, as it would after a reload', async ($, on) => {
  on('state.get', { plugin: 'stopwatch', key: 'totals' }, () => ({
    value: { value: { Edit: { calls: 4, ms: 3_120 }, Read: { calls: 9, ms: 1_480 } }, version: 3 },
  }))

  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text).toContain('13 tool calls, 4.6 s in tools')
  expect(answer.text).toContain('Read 1.5 s')
})

test('calls that overlap are all timed, each from its own start', async ($, on) => {
  const tools = runTools($, on)
  recordStatus(on)

  // Three calls end together at 1240 ms, and three at 3420 ms.
  await tools.calls([
    { input: { tool: 'Read', file_path: '/work/a.md' }, at: 0, ms: 1_240 },
    { input: { tool: 'Bash', command: 'ls' }, at: 0, ms: 3_420 },
    { input: { tool: 'Bash', command: 'pwd' }, at: 200, ms: 3_220 },
    { input: { tool: 'Read', file_path: '/work/b.md' }, at: 300, ms: 940 },
    { input: { tool: 'Read', file_path: '/work/c.md' }, at: 600, ms: 640 },
    { input: { tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, at: 1_000, ms: 2_420 },
  ])
  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text).toContain('6 tool calls, 11.9 s in tools')
  expect(answer.text).toContain('Bash 6.6 s')
  expect(answer.text).toContain('Read 2.8 s')
  expect(answer.text).toContain('Edit 2.4 s')
})
