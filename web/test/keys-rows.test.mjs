import assert from 'node:assert/strict'
import { test } from 'node:test'

import { capOf, explain, hookLines, keyParts, kindOf, runsOf, TRIES } from '../public/keys-rows.js'

const edit = (key, start, end, inserted, before, after, cursor, extra = {}) => ({
  seq: 1,
  at: 0,
  kind: 'edit',
  origin: 'composer',
  key,
  splice: { start, end, inserted },
  before,
  after,
  cursor,
  decorations: 0,
  isRewritten: false,
  ...extra,
})
const change = (origin, after) => ({
  seq: 1,
  at: 0,
  kind: 'change',
  origin,
  key: null,
  splice: null,
  before: null,
  after,
  cursor: after,
  decorations: 0,
  isRewritten: false,
})

test('a key name splits into its modifiers and the key, a plus sign among keys', () => {
  assert.deepEqual(keyParts('ctrl+u'), { modifiers: ['ctrl'], key: 'u' })
  assert.deepEqual(keyParts('ctrl++'), { modifiers: ['ctrl'], key: '+' })
  assert.deepEqual(keyParts('text'), { modifiers: [], key: 'text' })
})

test('each row has a kind, from the splice of an edit or the origin of a change', () => {
  assert.equal(kindOf(edit('text', 3, 3, 1, 3, 4, 4)), 'type')
  assert.equal(kindOf(edit('backspace', 3, 4, 0, 4, 3, 3)), 'delete')
  assert.equal(kindOf(edit('left', 1, 1, 0, 4, 4, 1)), 'move')
  assert.equal(kindOf(edit(null, 7, 7, 17, 9, 26, 24)), 'paste')
  assert.equal(kindOf(edit('text', 2, 5, 1, 9, 7, 3)), 'replace')
  assert.equal(kindOf(change('plugin mod-lab', 13)), 'fill')
  assert.equal(kindOf(change('history', 40)), 'history')
  assert.equal(
    kindOf(change('a-kind-from-a-later-build', 4)),
    'engine',
    'an origin this page does not know counts as engine',
  )
})

test('keycaps name a key by glyph with its modifiers, never a typed character', () => {
  assert.equal(capOf(edit('text', 0, 0, 1, 0, 1, 1)), 'typed')
  assert.equal(capOf(edit('ctrl+u', 0, 24, 0, 26, 2, 0)), '⌃U')
  assert.equal(capOf(edit('shift+tab', 0, 0, 0, 2, 2, 0)), '⇧⇥')
  assert.equal(capOf(edit(null, 7, 7, 17, 9, 26, 24)), 'paste +17')
  assert.equal(capOf(change('plugin filler-p1', 3)), 'fill · filler-p1')
})

test('consecutive rows with one keycap are one run with a count', () => {
  const rows = [
    edit('text', 0, 0, 1, 0, 1, 1),
    edit('text', 1, 1, 1, 1, 2, 2),
    edit('backspace', 1, 2, 0, 2, 1, 1),
    change('clear', 0),
  ]
  assert.deepEqual(
    runsOf(rows).map(run => [run.cap, run.rows.length, run.group]),
    [
      ['typed', 2, 'type'],
      ['⌫', 1, 'delete'],
      ['clear', 1, 'change'],
    ],
  )
})

test('the sentence and the hook say what happened in lengths, and keep no text', () => {
  const row = edit('backspace', 3, 4, 0, 4, 3, 3)
  assert.equal(explain(row), 'Backspace removed 1 character, 3–4. The box went from 4 to 3 characters.')
  assert.match(hookLines(row), /e\.key: {7}\{ key: 'backspace' \}/)
  assert.match(hookLines(edit('text', 0, 0, 1, 0, 1, 1)), /\{ key: '…' \} \(one character; the lab keeps none\)/)
  assert.match(hookLines(change('plugin mod-lab', 13)), /\{ kind: 'plugin', name: 'mod-lab' \}/)
})

test('every try is ticked by the row it asks for', () => {
  const rows = [
    edit('text', 0, 0, 1, 0, 1, 1),
    edit('backspace', 0, 1, 0, 1, 0, 0),
    edit('left', 0, 0, 0, 0, 0, 0),
    edit(null, 0, 0, 5, 0, 5, 5),
    change('history', 30),
    change('clear', 0),
    change('plugin mod-lab', 13),
    change('engine', 17),
    edit('text', 0, 0, 1, 0, 2, 1, { isRewritten: true, decorations: 2 }),
  ]
  assert.deepEqual(
    TRIES.map(one => rows.some(one.test)),
    TRIES.map(() => true),
  )
  assert.deepEqual(
    TRIES.map(one => one.test(rows[0])),
    TRIES.map(one => one.id === 'type'),
  )
})
