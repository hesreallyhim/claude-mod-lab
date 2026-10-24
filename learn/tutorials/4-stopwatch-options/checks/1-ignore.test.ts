import { expect, test } from 'claude-code/testing'

import { runTools, slash } from './kit'

test('a tool the ignore option names is not timed', { options: { ignore: 'Read, Write' } }, async ($, on) => {
  const tools = runTools($, on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  await tools.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, 1_240)
  await tools.call({ tool: 'Write', file_path: '/work/c.md', content: 'c' }, 600)
  await tools.call({ tool: 'Edit', file_path: '/work/b.md', old_string: 'x', new_string: 'y' }, 2_480)
  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text).toBe('2 tool calls, 3.7 s in tools: Edit 3.7 s')
  expect(tools.status).toHaveLength(2)
})

test('with the option left empty, every tool is timed', async ($, on) => {
  const tools = runTools($, on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  await tools.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, 860)
  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text).toContain('2 tool calls, 2.1 s in tools')
})
