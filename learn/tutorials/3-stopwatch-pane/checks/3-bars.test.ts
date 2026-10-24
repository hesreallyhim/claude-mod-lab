import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import type { Tools } from './kit'
import { barsOf, pane, runTools } from './kit'

/** Four Reads of 1.2 s each and a Bash of 860 ms. */
async function callSome(tools: Tools) {
  for (const path of ['/a', '/b', '/c', '/d']) await tools.call({ tool: 'Read', file_path: path }, 1_240)
  await tools.call({ tool: 'Bash', command: 'ls' }, 860)
}

/** The bar rows of a pane `columns` wide; there must be one for Read and one for Bash. */
async function barsAt($: Engine, columns: number) {
  const ui = await $.ui.mount(pane(columns))
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
  await ui.unmount()
  const bars = barsOf(texts, ['Read', 'Bash'])
  expect(bars.map(bar => bar.tool).sort(), `a row for each tool, as "<tool> <bar> <time>"; the pane drew:\n${texts.join('\n')}`).toEqual(['Bash', 'Read'])
  return bars
}

test('the tool with the most time has the longest bar', async ($, on) => {
  const tools = runTools($, on)
  await callSome(tools)

  const bars = await barsAt($, 60)

  const length = (tool: string) => bars.find(bar => bar.tool === tool)?.length ?? 0
  expect(length('Read')).toBeGreaterThan(length('Bash'))
})

for (const columns of [36, 72]) {
  test(`no row of bars is wider than a pane ${columns} columns wide`, async ($, on) => {
    const tools = runTools($, on)
    await callSome(tools)

    const bars = await barsAt($, columns)

    for (const bar of bars) expect(bar.text.length).toBeLessThanOrEqual(columns)
  })
}

test('a wider pane draws longer bars', async ($, on) => {
  const tools = runTools($, on)
  await callSome(tools)

  const narrow = await barsAt($, 36)
  const wide = await barsAt($, 72)

  const read = (bars: { tool: string; length: number }[]) => bars.find(bar => bar.tool === 'Read')?.length ?? 0
  expect(read(wide)).toBeGreaterThan(read(narrow))
})
