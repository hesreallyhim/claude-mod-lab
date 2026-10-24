import { expect, test } from 'claude-code/testing'

import { agent, ended, engine, TYPE } from './kit'

test("an errand's answer comes back as a line in the transcript when its turn ends", async ($, on) => {
  const seen = engine(on, [agent('agent-e1', TYPE)])

  await $.turn.complete(ended('answer-a1 from the errand', 'agent-e1'))

  expect(seen.logged.some(line => line.includes('answer-a1 from the errand'))).toBe(true)
})

test("another agent's answer is not an errand's, and neither is the main loop's", async ($, on) => {
  const seen = engine(on, [agent('agent-e1', TYPE), agent('agent-g2', 'general-purpose')])

  await $.turn.complete(ended('answer-a2 from another agent', 'agent-g2'))
  await $.turn.complete(ended('answer-a3 from the main loop'))

  expect(seen.logged).toEqual([])
})
