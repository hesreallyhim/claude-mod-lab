import { expect, test } from 'claude-code/testing'

import { answerOpen, pane, runTools, slash } from './kit'

test('/stopwatch pane opens a pane with the id stopwatch', async ($, on) => {
  const opened = answerOpen(on)

  const answer = await $.command.run(slash('stopwatch', 'pane'))

  expect(opened).toEqual(['stopwatch'])
  expect(answer.text?.trim()).not.toBe('')
})

test('the pane draws on the terminal', async $ => {
  const ui = await $.ui.mount(pane(60))

  expect(await ui.findAll({ type: 'Text' })).not.toHaveLength(0)
})

test('/stopwatch on its own still answers with the totals, and opens nothing', async ($, on) => {
  const tools = runTools($, on)
  const opened = answerOpen(on)
  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)

  const answer = await $.command.run(slash('stopwatch'))

  expect(answer.text).toContain('Read 1.2 s')
  expect(opened).toEqual([])
})
