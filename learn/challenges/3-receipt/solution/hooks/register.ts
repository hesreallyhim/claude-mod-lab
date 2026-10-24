// receipt: the challenge's solution. ../README.md says what it asks.

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

/** The items in a call, or what is wrong with them, for the model to put right. */
function itemsOf(input: unknown): Item[] | string {
  const items = (input as { items?: unknown }).items
  if (!Array.isArray(items)) return 'items must be a list of { name, price, quantity }'
  const bad = items.find(item => !Number.isFinite(item?.price) || !Number.isFinite(item?.quantity))
  if (bad !== undefined) return `each item needs a number for price and for quantity, and ${JSON.stringify(bad)} does not have both`
  return items as Item[]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'total',
      description: 'Adds up a list of items, each a name, a unit price and a quantity, and answers the total.',
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__receipt__total' }, async ($, e) => {
    const items = itemsOf(e)
    if (typeof items === 'string') return { deny: `receipt: ${items}` }
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    return { result: `${items.length} item${items.length === 1 ? '' : 's'}, total ${total.toFixed(2)}` }
  })
}
