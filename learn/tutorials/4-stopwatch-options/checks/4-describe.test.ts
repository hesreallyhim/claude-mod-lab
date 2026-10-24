import { expect, test } from 'claude-code/testing'

import { describing, invalidations, menu, runTools } from './kit'

const TITLE = 'Slow after, in seconds'

test('the slowAfter row says how many calls have gone over it', { options: { slowAfter: 2 } }, async ($, on) => {
  const tools = runTools($, on)
  menu(on)
  invalidations(on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  await tools.call({ tool: 'Bash', command: 'make a-o3' }, 3_420)
  await tools.call({ tool: 'Bash', command: 'make b-o3' }, 2_870)
  await tools.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, 2_310)
  const described = await describing($, 'stopwatch.slowAfter', TITLE)

  expect(described.label.startsWith(TITLE)).toBe(true)
  expect(described.label).toContain('3 calls over')
})

test('a slow call, and no other, asks the engine to describe the rows again', { options: { slowAfter: 2 } }, async ($, on) => {
  const tools = runTools($, on)
  menu(on)
  const asked = invalidations(on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  expect(asked).not.toContain('config.describe')

  await tools.call({ tool: 'Bash', command: 'make s-o3' }, 3_420)
  expect(asked).toContain('config.describe')
})

test('with no call over, and on the other rows, the label is as it came', async ($, on) => {
  const tools = runTools($, on)
  menu(on)
  invalidations(on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)

  expect((await describing($, 'stopwatch.slowAfter', TITLE)).label).toBe(TITLE)
  expect((await describing($, 'stopwatch.ignore', 'Tools to leave out')).label).toBe('Tools to leave out')
})
