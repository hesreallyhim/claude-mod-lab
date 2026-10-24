import { expect, test } from 'claude-code/testing'

import { drawn, EMPTY, pane, runTools, slash } from './kit'

test('Reset empties the pane, and /stopwatch answers as it did before any call', async ($, on) => {
  const tools = runTools($, on)
  const before = (await $.command.run(slash('stopwatch'))).text
  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  const ui = await $.ui.mount(pane(60))

  await ui.press({ key: 'reset' })

  expect(await drawn(ui)).toContain(EMPTY)
  expect((await $.command.run(slash('stopwatch'))).text).toBe(before)
})

test('Reset clears the status line', async ($, on) => {
  const tools = runTools($, on)
  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  const ui = await $.ui.mount(pane(60))

  await ui.press({ key: 'reset' })

  expect(tools.status.at(-1)).toBeUndefined()
})
