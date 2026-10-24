import { expect, test } from 'claude-code/testing'

import { ears } from './kit'

test('a quick turn ends without a sound', async ($, on) => {
  const { played, finish } = ears($, on)

  await finish(5)

  expect(played).toEqual([])
})

test('a turn of 20 seconds or more still rings', async ($, on) => {
  const { played, finish } = ears($, on)

  await finish(20)

  expect(played).toEqual(['sounds/chime.wav'])
})

test("one of Claude's agents finishing makes no sound", async ($, on) => {
  const { played, finish } = ears($, on)

  await finish(45, 'Found it.', 'agent-a1')

  expect(played).toEqual([])
})
