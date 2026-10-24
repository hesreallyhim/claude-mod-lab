import { expect, test } from 'claude-code/testing'

import { drawn, pane, runTools } from './kit'

test("the pane shows the latest call's time and its command or path", async ($, on) => {
  const tools = runTools($, on)
  await tools.call({ tool: 'Read', file_path: '/work/first.md' }, 1_240)
  await tools.call({ tool: 'Bash', command: 'make test-l5' }, 3_420)

  const ui = await $.ui.mount(pane(60))

  expect(await drawn(ui)).toMatch(/Bash 3\.4 s.*make test-l5/)
})

test('a failed latest call is marked failed', async ($, on) => {
  const tools = runTools($, on)
  await tools.call({ tool: 'Bash', command: 'make test-f5' }, 2_310, { isError: true, result: 'exit 2', text: 'exit 2' })

  const ui = await $.ui.mount(pane(60))

  expect(await drawn(ui)).toMatch(/Bash 2\.3 s.*failed.*make test-f5/)
})

test('a command holding escape sequences and control characters is still drawn, without them', async ($, on) => {
  const tools = runTools($, on)
  // A colour, a terminal title (an escape sequence ended by a bell) and a bare bell: the engine draws none of them.
  await tools.call({ tool: 'Bash', command: "printf '\x1b[31mred-e6\x1b[0m\x1b]0;title\x07\x07\\n'" }, 120)

  const ui = await $.ui.mount(pane(60))
  const text = await drawn(ui)

  expect(text).toContain('red-e6')
  expect(text).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
})
