import { expect, test } from 'claude-code/testing'

import { ears } from './kit'

test('when Claude finishes a long turn, the chime plays', async ($, on) => {
  const { played, finish } = ears($, on)

  await finish(30)

  expect(played).toEqual(['sounds/chime.wav'])
})
