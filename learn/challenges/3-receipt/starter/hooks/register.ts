// receipt: a challenge. ../README.md says what to do; the checks in
// learn/challenges/3-receipt/checks say when it is done.

import type { Register } from 'claude-code'

type Item = { name: string; price: number; quantity: number }

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, price: { type: 'number' }, quantity: { type: 'number' } },
        required: ['name', 'price', 'quantity'],
      },
    },
  },
  required: ['items'],
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'total',
      description: 'Adds up a list of items, each a name, a unit price and a quantity, and answers the total.',
      inputSchema: INPUT_SCHEMA,
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__receipt__totals' }, async ($, e) => {
    const items = e.items as Item[]
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    return { result: { items: items.length, total } }
  })
}
