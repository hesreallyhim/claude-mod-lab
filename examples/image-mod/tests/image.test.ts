import { expect, test } from 'claude-code/testing'

import { hues } from '../hooks/register'

test('the pane draws one Image with its alt, and a frame is four bytes a pixel', async ($, on) => {
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount({ plugin: 'image-mod', surface: 'terminal', component: 'Pane', requestId: 'image-mod', props: { title: 'image-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })

  const image = await ui.find({ type: 'Image', key: 'hues' })
  const { width, height, rgba } = hues(3)

  expect(String((image?.props as { alt?: string }).alt ?? '')).not.toBe('')
  expect(atob(rgba).length).toBe(width * height * 4)
})
