import { expect, test } from 'claude-code/testing'

import { ears } from './kit'

test("after a long turn, the first sentence of Claude's answer is said", async ($, on) => {
  const { said, finish } = ears($, on)

  await finish(30, '**All 41 tests pass.** I also fixed the import in `parser.ts`.')

  expect(said).toEqual(['All 41 tests pass.'])
})

test('after a quick turn, nothing is said', async ($, on) => {
  const { said, finish } = ears($, on)

  await finish(5, 'Sure.')

  expect(said).toEqual([])
})
