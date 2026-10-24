import { expect, test } from 'claude-code/testing'

import { neighbor, neighborsCwd, realCwd, slash } from './kit'

test("another plugin's $.session.cwd() still gets the real directory", { plugins: [neighbor] }, async ($, on) => {
  realCwd(on, '/real/project-o1')

  expect(await neighborsCwd($)).toBe('/real/project-o1')
})

test('both at once: /where is told /sandbox while the other plugin gets the real one', { plugins: [neighbor] }, async ($, on) => {
  const engine = realCwd(on, '/real/project-o2')

  const [mine, theirs] = await Promise.all([$.command.run(slash('where')), neighborsCwd($)])

  expect(mine.text).toBe('/sandbox')
  expect(theirs).toBe('/real/project-o2')
  expect(engine.asked).toBe(1)
})
