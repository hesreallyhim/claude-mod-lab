import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FILLER_WORDS, fillerText } from '../lib/filler.mjs'

const wordsIn = text => text.split(/\s+/).length

test('each size gives the same lorem ipsum every time, about as many words as it names', () => {
  for (const words of Object.values(FILLER_WORDS)) {
    const text = fillerText(words)
    assert.equal(fillerText(words), text)
    assert.match(text, /^Lorem ipsum dolor sit amet, consectetur adipiscing elit\./)
    assert.ok(Math.abs(wordsIn(text) - words) < 20, `${wordsIn(text)} words for ${words}`)
  }
  assert.ok(FILLER_WORDS.long > 3 * FILLER_WORDS.short)
})
