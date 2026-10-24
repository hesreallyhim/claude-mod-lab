import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readValidation } from '../../learn/lib/lessons.mjs'
import { capabilityItems } from '../public/mods.js'

test('validator notes become individual capabilities, preserving helper and filter qualifiers', () => {
  const { facts } = readValidation(
    {
      success: true,
      contents: [
        {
          notes: [
            './register.ts hooks: session.start, tool.call{tool=Read, source=model}, prompt.edit',
            './register.ts calls: $.ui.status (via render, refresh), $.state.get, $.model.complete (via run)',
            './other.ts hooks: session.start',
          ],
        },
      ],
    },
    'example',
  )
  assert.deepEqual(capabilityItems('hooks', facts.hooks), [
    'session.start',
    'tool.call{tool=Read, source=model}',
    'prompt.edit',
  ])
  assert.deepEqual(capabilityItems('calls', facts.calls), [
    '$.ui.status (via render, refresh)',
    '$.state.get',
    '$.model.complete (via run)',
  ])
})

test('nested qualifiers and quoted commas stay intact, including escaped quotes', () => {
  assert.deepEqual(
    capabilityItems('hooks', ['tool.call{tool=[Read, Edit], value="a, b\\"c"}, prompt.fill (via a(b, c), d)']),
    ['tool.call{tool=[Read, Edit], value="a, b\\"c"}', 'prompt.fill (via a(b, c), d)'],
  )
  assert.deepEqual(capabilityItems('answers', ["'one, two', `three, four`, five"]), [
    "'one, two'",
    '`three, four`',
    'five',
  ])
})

test('each state or gating item retains the qualifier applying to the whole note', () => {
  assert.deepEqual(capabilityItems('state', ['reads example.one, example.two', 'writes example.one']), [
    'reads example.one',
    'reads example.two',
    'writes example.one',
  ])
  assert.deepEqual(capabilityItems('gating', ['tool.call, turn.step with .catch', 'prompt.edit without .catch']), [
    'tool.call with .catch',
    'turn.step with .catch',
    'prompt.edit without .catch',
  ])
  assert.deepEqual(capabilityItems('hooks', []), [])
})
