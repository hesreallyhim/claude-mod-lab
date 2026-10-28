import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bubbler, fizzing, LIQUID, mulberry32, NECK, rising, stepAt } from '../public/bubbles.js'

const inOrder = steps => steps.every((step, i) => i === 0 || step.t > steps[i - 1].t)

test('a bubble from the neck rises a row at a time above the lip, within a cell of the neck, and goes out', () => {
  const rand = mulberry32(1)
  for (let i = 0; i < 50; i++) {
    const steps = rising(rand, 3)
    assert.ok(inOrder(steps))
    assert.equal(steps[0].t, 3)
    const lit = steps.slice(0, -1)
    assert.deepEqual(
      lit.map(step => step.y),
      lit.map((_, rise) => -1 - rise),
    )
    assert.ok(lit.every(step => Math.abs(step.x - NECK) <= 1 && step.o > 0 && step.role === 'bubble'))
    assert.equal(steps.at(-1).o, 0)
  }
})

test('a bubble in the liquid stays inside it as an unlit cell, then pops just above the surface', () => {
  const rand = mulberry32(2)
  for (let i = 0; i < 50; i++) {
    const steps = fizzing(rand, 0)
    assert.ok(inOrder(steps))
    const inside = steps.filter(step => step.role === 'fizz')
    assert.equal(inside[0].y, LIQUID.bottom)
    assert.ok(inside.every(s => s.x >= LIQUID.left && s.x <= LIQUID.right && s.y >= LIQUID.top && s.y <= LIQUID.bottom))
    const pop = steps.at(-2)
    assert.deepEqual([pop.role, pop.y], ['bubble', LIQUID.top - 1])
    assert.equal(steps.at(-1).o, 0)
  }
})

test('a bubble shows nothing before it starts or once it has gone out', () => {
  const steps = rising(mulberry32(3), 10)
  assert.equal(stepAt(steps, 9.99), null)
  assert.equal(stepAt(steps, 10), steps[0])
  assert.equal(stepAt(steps, steps.at(-1).t), null)
})

test('an excited flask sends up more bubbles than a calm one in the same time', () => {
  const departures = excitement => {
    const tick = bubbler(mulberry32(4))
    const seen = new Set()
    for (let t = 0; t < 120; t += 1 / 30) {
      for (const step of tick(t, excitement))
        if (step.y === -1 || step.y === LIQUID.bottom) seen.add(`${step.x}:${step.y}:${step.t}`)
    }
    return seen.size
  }
  const calm = departures(0)
  assert.ok(calm > 60, `calm: ${calm}`)
  assert.ok(departures(1) > 2 * calm, `excited: ${departures(1)}, calm: ${calm}`)
})

test('a long pause resumes the bubbles without a burst of new ones', () => {
  const tick = bubbler(mulberry32(5))
  for (let t = 0; t < 30; t += 1 / 30) tick(t)
  const before = tick(30).length
  assert.ok(tick(600).length <= before + 2)
})
