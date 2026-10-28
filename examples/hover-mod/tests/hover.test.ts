import { expect, test } from 'claude-code/testing'

type Drawn = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

function elementsOf(node: unknown, found: Drawn[] = []): Drawn[] {
  if (node === null || typeof node !== 'object') return found
  found.push(node as Drawn)
  for (const child of (node as Drawn).children ?? []) elementsOf(child, found)
  return found
}

test('each card is drawn hidden, and shown by the hover group it shares with its word', async $ => {
  const ui = await $.ui.mount({ plugin: 'hover-mod', surface: 'terminal', component: 'Pane', requestId: 'hover-mod', props: { title: 'hover-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })

  const elements = elementsOf(await ui.drawn())
  const cards = elements.filter(element => element.props?.display === 'none')
  const words = elements.filter(element => element.hover !== undefined && element.props?.display !== 'none')

  expect(cards.length).toBe(3)
  for (const card of cards) {
    expect(card.hover).toMatchObject({ display: 'flex' })
    expect(words.some(word => word.hover?.scope === card.hover?.scope)).toBe(true)
  }
})

test('nothing sets a color the theme might not pair: the word lights by inverse, and no background is drawn', async $ => {
  const ui = await $.ui.mount({ plugin: 'hover-mod', surface: 'terminal', component: 'Pane', requestId: 'hover-mod', props: { title: 'hover-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })

  const elements = elementsOf(await ui.drawn())
  const lit = elements.filter(element => element.type === 'Text' && element.hover?.inverse === true)

  expect(lit.length).toBe(3)
  expect(elements.some(element => element.hover?.backgroundColor !== undefined || element.props?.backgroundColor !== undefined)).toBe(false)
})
