import { expect, test } from 'claude-code/testing'

import { boardOf, CLIENT_SURFACES, pane, store } from './kit'

test('on the surfaces that draw one, the pane holds the board, a Client running ./board.tsx', async ($, on) => {
  store(on)

  for (const surface of CLIENT_SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const client = await ui.find({ type: 'Client', key: 'board' })
    expect(String((client?.props as { module?: string } | undefined)?.module ?? '')).toContain('board.tsx')
    const rows = await boardOf(ui)
    expect(rows.some(row => row.includes('███')), `the snake is drawn; the board drew:\n${rows.join('\n')}`).toBe(true)
    expect(rows.some(row => row.includes('◆'))).toBe(true)
    const drawn = (await ui.findAll({ type: 'Text', in: 'board' })).filter(text => /[█◆]/.test(text.text))
    expect(
      drawn.every(text => (text.props as { mono?: boolean }).mono === true),
      'each row is drawn with mono, so a cell is as wide as a space where text is proportional (desktop)',
    ).toBe(true)
    await ui.unmount()
  }
})

test('a surface with no Client says so instead', async ($, on) => {
  store(on)

  const ui = await $.ui.mount(pane('mobile'))

  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).length).toBeGreaterThan(0)
})
