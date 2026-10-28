import assert from 'node:assert/strict'
import { test } from 'node:test'

import { falloff } from '../public/cell-glow.js'

test('the glow is strongest under the pointer and fades to nothing at its reach', () => {
  assert.equal(falloff(0), 1)
  const steps = [1, 2, 4, 6, 8].map(falloff)
  assert.ok(steps.every((v, i) => v > 0 && v < 1 && (i === 0 || v < steps[i - 1])))
  assert.equal(falloff(9), 0)
  assert.equal(falloff(40), 0)
})
