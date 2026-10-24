import { expect, test } from 'claude-code/testing'

import { drawn, pane, runTools } from './kit'

test('a call longer than the slowAfter option is marked slow on the status line', { options: { slowAfter: 2 } }, async ($, on) => {
  const tools = runTools($, on)

  await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
  await tools.call({ tool: 'Bash', command: 'make build-s2' }, 3_420)

  expect(tools.status).toHaveLength(2)
  expect(tools.status[0]).toBe('Read 1.2 s')
  expect(tools.status[1]).toMatch(/^Bash 3\.4 s\b.*slow/)
})

test("a slow call is marked on the pane's latest line too", { options: { slowAfter: 2 } }, async ($, on) => {
  const tools = runTools($, on)
  await tools.call({ tool: 'Bash', command: 'make test-s2' }, 3_420)

  const ui = await $.ui.mount(pane(60))

  expect(await drawn(ui)).toMatch(/latest: Bash 3\.4 s.*slow.*make test-s2/)
})

test('left at its default of five seconds, 4.9 s is not slow and 5.1 s is', async ($, on) => {
  const tools = runTools($, on)

  await tools.call({ tool: 'Bash', command: 'make a-d5' }, 4_870)
  await tools.call({ tool: 'Bash', command: 'make b-d5' }, 5_130)

  expect(tools.status[0]).toBe('Bash 4.9 s')
  expect(tools.status[1]).toMatch(/^Bash 5\.1 s\b.*slow/)
})

test('a failed call that was slow is marked both', { options: { slowAfter: 1 } }, async ($, on) => {
  const tools = runTools($, on)

  await tools.call({ tool: 'Bash', command: 'make test-f1' }, 2_310, { isError: true, result: 'exit 2', text: 'exit 2' })

  expect(tools.status[0]).toMatch(/^Bash 2\.3 s\b/)
  expect(tools.status[0]).toContain('failed')
  expect(tools.status[0]).toContain('slow')
})
