import { expect, test } from 'claude-code/testing'

import { engine, offer, TYPE } from './kit'

test('the model is not offered the errand type', async ($, on) => {
  engine(on)
  on('agent.offer', () => ({ isOffered: true }))

  const answer = await $.agent.offer(offer(TYPE))

  expect(answer.isOffered).toBe(false)
})

test('every other type is offered as it came', async ($, on) => {
  engine(on)
  on('agent.offer', () => ({ isOffered: true }))

  const others = [await $.agent.offer(offer('general-purpose')), await $.agent.offer(offer('Explore'))]

  expect(others.map(one => one.isOffered)).toEqual([true, true])
})
