import { expect, test } from 'claude-code/testing'

import { drawn, EMPTY, pane, runTools } from './kit'

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`the pane lists each tool with its time, under the totals, on ${surface}`, async ($, on) => {
    const tools = runTools($, on)
    await tools.call({ tool: 'Read', file_path: '/work/a.md' }, 1_240)
    await tools.call({ tool: 'Bash', command: 'ls' }, 860)
    await tools.call({ tool: 'Read', file_path: '/work/b.md' }, 430)

    const ui = await $.ui.mount(pane(60, surface))

    expect(await drawn(ui)).toContain('3 tool calls, 2.5 s in tools')
    expect(await drawn(ui)).toMatch(/^Read\b.*\b1\.7 s$/m)
    expect(await drawn(ui)).toMatch(/^Bash\b.*\b860 ms$/m)
  })
}

test('an empty stopwatch says so', async $ => {
  const ui = await $.ui.mount(pane(60))

  expect(await drawn(ui)).toContain(EMPTY)
})

test('the pane redraws as calls are made, without being opened again', async ($, on) => {
  const tools = runTools($, on)
  const ui = await $.ui.mount(pane(60))

  await tools.call({ tool: 'Edit', file_path: '/work/a.md', old_string: 'x', new_string: 'y' }, 2_310)

  expect(await drawn(ui)).toMatch(/^Edit\b.*\b2\.3 s$/m)
})
