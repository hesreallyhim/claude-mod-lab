import { expect, test } from 'claude-code/testing'

test("a press on one of the mod's links turns the page", async $ => {
  const ui = await $.ui.mount({ plugin: 'links-mod', surface: 'terminal', component: 'Pane', requestId: 'links-mod', props: { title: 'links-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })

  await ui.press({ key: 'page', link: { href: 'https://links-mod.invalid/about' } })
  const title = await ui.find({ type: 'Text' })

  expect(title?.text).toBe('about')
})
