import { expect, test } from 'claude-code/testing'

import { TOOL } from './kit'

test('a call without a list of items is refused with a reason', async $ => {
  const answer = await $.tool.call({ tool: TOOL, things: 'tea' })

  expect(answer).toMatchObject({ deny: expect.stringMatching(/^receipt:/) })
})

test('an item whose price is not a number is refused with a reason that names it', async $ => {
  const answer = await $.tool.call({ tool: TOOL, items: [{ name: 'cake-r7', price: 'free', quantity: 1 }] })

  expect(answer).toMatchObject({ deny: expect.stringMatching(/^receipt:.*cake-r7/) })
})

test('an item whose quantity is not a number is refused with a reason that names it', async $ => {
  const answer = await $.tool.call({ tool: TOOL, items: [{ name: 'tea-q8', price: 2.5, quantity: 'two' }] })

  expect(answer).toMatchObject({ deny: expect.stringMatching(/^receipt:.*tea-q8/) })
})
