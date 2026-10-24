import { expect, test } from 'claude-code/testing'

import { recordStatus, runTools } from './kit'

test('each tool call puts its tool and its time on the status line', async ($, on) => {
  const tools = runTools($, on)
  const status = recordStatus(on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  await tools.call({ tool: 'Bash', command: 'ls' }, 40)

  expect(status).toEqual(['Read 1.2 s', 'Bash 40 ms'])
})

test('a call that failed, or was refused, is marked failed', async ($, on) => {
  const tools = runTools($, on)
  const status = recordStatus(on)

  await tools.call({ tool: 'Bash', command: 'make test-m7' }, 2_310, { isError: true, result: 'exit 1', text: 'exit 1' })
  await tools.call({ tool: 'Edit', file_path: '/work/m7.md', old_string: 'x', new_string: 'y' }, 380, { deny: 'not now-m7' })

  expect(status).toHaveLength(2)
  expect(status[0]).toMatch(/^Bash 2\.3 s\b.*failed/)
  expect(status[1]).toMatch(/^Edit 380 ms\b.*failed/)
})
