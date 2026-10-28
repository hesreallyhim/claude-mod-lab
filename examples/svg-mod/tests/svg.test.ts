import { expect, test } from 'claude-code/testing'
import type { RenderPropsOf, RenderSurface } from 'claude-code'

const props: RenderPropsOf['Pane'] = { title: 'svg-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }

async function callTools($: { tool: { call: (input: never) => Promise<unknown> } }): Promise<void> {
  for (const tool of ['Read', 'Read', 'Bash']) await $.tool.call({ tool } as never)
}

const mounted = (surface: RenderSurface) => ({ plugin: 'svg-mod', surface, component: 'Pane' as const, requestId: 'svg-mod', props })

test('where the surface has Svg, the counts are one Svg chart, a bar a tool', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  await callTools($)

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(mounted(surface))
    const svg = await ui.find({ type: 'Svg' })
    const source = String((svg?.props as { source?: string }).source ?? '')
    expect(source.match(/<rect/g)?.length).toBe(2)
    await ui.unmount()
  }
})

test('the terminal, which has no Svg, draws the counts as glyphs', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  await callTools($)

  const ui = await $.ui.mount(mounted('terminal'))
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

  expect(texts.some(text => text.startsWith('Read') && text.endsWith(' 2'))).toBe(true)
})
