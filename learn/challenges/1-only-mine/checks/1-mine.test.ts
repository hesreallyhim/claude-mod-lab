import { expect, test } from 'claude-code/testing'

import { realCwd, slash } from './kit'

test('/where says /sandbox', async ($, on) => {
  realCwd(on, '/real/project-m1')

  const answer = await $.command.run(slash('where'))

  expect(answer.text).toBe('/sandbox')
})

test("the engine is not asked for the mod's own directory", async ($, on) => {
  const engine = realCwd(on, '/real/project-m2')

  await $.command.run(slash('where'))

  expect(engine.asked).toBe(0)
})
