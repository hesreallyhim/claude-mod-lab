import { expect, test } from 'claude-code/testing'

const band = { plugin: 'band-mod', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', props: { hasSurvey: false } }

test("the band counts the session's tool calls and names the last", async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }) as never)
  await $.command.run({ command: 'band-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as never)

  for (const tool of ['Read', 'Bash']) await $.tool.call({ tool } as never)
  const ui = await $.ui.mount(band as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

  expect(texts).toContain('2 tool calls')
  expect(texts).toContain('last: Bash')
})

test('the band is opt-in and counts only while enabled', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }) as never)
  const ui = await $.ui.mount(band as never)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(text => text.text)
  await $.tool.call({ tool: 'Read' } as never)
  expect(await texts()).toEqual([])
  await $.command.run({ command: 'band-mod', args: 'on' } as never)
  expect(await texts()).toContain('0 tool calls')
  await $.tool.call({ tool: 'Bash' } as never)
  expect(await texts()).toContain('1 tool call')
  await $.command.run({ command: 'band-mod', args: 'off' } as never)
  await $.tool.call({ tool: 'Read' } as never)
  expect(await texts()).toEqual([])
  await $.command.run({ command: 'band-mod', args: '' } as never)
  expect(await texts()).toContain('1 tool call')
})
