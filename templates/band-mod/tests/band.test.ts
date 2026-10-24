import { expect, test } from 'claude-code/testing'

const band = { plugin: 'band-mod', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', props: { hasSurvey: false } }

test("the band counts the session's tool calls and names the last", async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }) as never)

  for (const tool of ['Read', 'Bash']) await $.tool.call({ tool } as never)
  const ui = await $.ui.mount(band as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

  expect(texts).toContain('2 tool calls')
  expect(texts).toContain('last: Bash')
})
