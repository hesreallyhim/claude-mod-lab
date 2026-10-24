import { expect, test } from 'claude-code/testing'

import { recordStatus, runTools, slash } from './kit'

const CLOCK = 'the time comes from $.clock.now(), which this check moves; it cannot move Date.now()'

test('/stopwatch sums the time spent in each tool', async ($, on) => {
  const tools = runTools($, on)
  recordStatus(on)

  await tools.call({ tool: 'Read', file_path: '/work/notes.md' }, 1_240)
  await tools.call({ tool: 'Bash', command: 'make build-q3' }, 3_420)
  await tools.call({ tool: 'Read', file_path: '/work/todo.md' }, 1_240)
  await tools.call({ tool: 'Read', file_path: '/work/plan.md' }, 1_240)
  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text, CLOCK).toContain('Read 3.7 s')
  expect(answer.text).toContain('Bash 3.4 s')
  expect(answer.text).toContain('4 tool calls, 7.1 s in tools')
})

test('a call under a second reads in milliseconds', async ($, on) => {
  const tools = runTools($, on)
  recordStatus(on)

  await tools.call({ tool: 'Read', file_path: '/work/k2.md' }, 40)
  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text, CLOCK).toContain('Read 40 ms')
})

test('a failed call and a refused one are timed too, and the model gets each answer unchanged', async ($, on) => {
  const tools = runTools($, on)
  recordStatus(on)

  const failure = await tools.call({ tool: 'Bash', command: 'make test-r4' }, 2_310, { isError: true, result: 'exit 2', text: 'exit 2' })
  const refusal = await tools.call({ tool: 'Write', file_path: '/work/r4.md', content: 'r4' }, 860, { deny: 'not this file-r4' })
  const answer = await $.command.run(slash('stopwatch'))

  expect(failure).toMatchObject({ isError: true, text: 'exit 2' })
  expect(refusal).toMatchObject({ deny: 'not this file-r4' })
  expect(answer.text, CLOCK).toContain('Bash 2.3 s')
  expect(answer.text).toContain('Write 860 ms')
})
