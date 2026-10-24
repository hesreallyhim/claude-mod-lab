import type { Plugin } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { lab, lastRun, recordState, slash } from './kit'

/** Another plugin that does what follows `/via-lab` through $.lab.command, as the explorer bridge does. */
const neighbor: Plugin = {
  name: 'neighbor',
  register(on) {
    on('command.run', { command: 'via-lab' }, async ($, e) => ({ text: await $.lab.command({ text: e.args }) }))
  },
}

test('another plugin sets an intercept through $.lab.command and gets the text /mod-lab intercept answers', { plugins: [neighbor] }, async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  const recorded = recordState(on)

  const answer = await $.command.run(slash('via-lab', 'intercept fs.exists refuse'))
  await $.command.run(lab('fs.exists README.md'))
  const direct = await $.command.run(lab('intercept fs.exists refuse'))

  expect(answer.text).toBe(direct.text)
  expect(recorded.intercepts.at(-1)?.map(one => one.event)).toEqual(['fs.exists'])
  expect(lastRun(recorded)?.ok).toBe(false)
})

test('a probe run through $.lab.command is recorded as from the explorer, with its dispatches', { plugins: [neighbor] }, async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  const recorded = recordState(on)

  const answer = await $.command.run(slash('via-lab', 'fs.exists README.md'))

  const run = lastRun(recorded)
  expect(run).toMatchObject({ probe: 'fs.exists', from: 'explorer', ok: true, value: true })
  expect(run?.dispatches.map(dispatch => dispatch.event)).toContain('fs.exists')
  expect(answer.text).toContain('fs.exists')
})

test('$.lab.command answers what /mod-lab answers for a word that is no probe', { plugins: [neighbor] }, async $ => {
  const answer = await $.command.run(slash('via-lab', 'no.such'))
  const direct = await $.command.run(lab('no.such'))

  expect(answer.text).toBe(direct.text)
  expect(answer.text).toContain('no.such')
})

/** Another plugin that answers `/lab-root` with $.lab.root(), as the explorer bridge reports it. */
const asker: Plugin = {
  name: 'asker',
  register(on) {
    on('command.run', { command: 'lab-root' }, async $ => ({ text: await $.lab.root() }))
  },
}

test("$.lab.root answers the lab's own folder to another plugin", { plugins: [asker] }, async $ => {
  const answer = await $.command.run(slash('lab-root', ''))

  // The kit loads the lab from its folder, so its root is that folder, absolute; the test's own $ has no $.plugin to compare with.
  expect(answer.text).toMatch(/^\/.+\/mod-lab$/)
})
