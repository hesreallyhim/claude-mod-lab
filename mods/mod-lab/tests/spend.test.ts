import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { addSpend, EMPTY_SPEND, spendCall } from '../hooks/spend'
import { lab, slash } from './kit'

/** The model beneath the plugins: answers every completion with the usage given, keeping what it was sent. */
function model(on: On, usage = { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) {
  const sent: { prompt: string; promptBlocks?: readonly { text: string; cache?: true }[]; system?: string }[] = []
  on('model.complete', ($, e) => {
    sent.push(e)
    return { value: { isAnswered: true as const, text: 'reply-m1', usage } }
  })
  return sent
}

/** Another plugin, whose /ask makes a completion of its own. */
const asker: Plugin = {
  name: 'asker',
  register(on) {
    on('command.run', { command: 'ask' }, async ($, e) => {
      const result = await $.model.complete({ model: 'haiku', prompt: e.args })
      return { text: result.isAnswered ? result.text : `not answered: ${result.reason}` }
    })
  },
}

test("a probe's completion is metered under the lab with the usage the model reported", async ($, on) => {
  model(on, { input_tokens: 31, output_tokens: 5, cache_read_input_tokens: 1_200, cache_creation_input_tokens: 0 })

  await $.command.run(lab('model.complete Say hello'))
  const report = await $.command.run(lab('spend'))

  // In the kit the test's own hook stands for the model, so nothing counts as sent; the usage is the stand-in's.
  expect(report.text).toContain('mod-lab: 1 call, 0 sent; in 31, out 5, cache read 1,200, cache written 0')
})

test('a prefix marked for the cache reaches the model as its own block, ahead of the prompt', async ($, on) => {
  const sent = model(on)

  await $.command.run(lab('model.complete {"prompt": "question-q1", "prefix": "fixed-f1", "cache": "yes"}'))
  await $.command.run(lab('model.complete {"prompt": "question-q2", "prefix": "fixed-f1"}'))

  expect(sent[0]?.promptBlocks).toEqual([{ text: 'fixed-f1', cache: true }, { text: 'question-q1' }])
  expect(sent[1]?.promptBlocks?.[0]).toEqual({ text: 'fixed-f1' })
  expect(sent[0]?.prompt).toContain('question-q1')
})

test("free mode answers the lab's completions with nothing sent, and leaves other plugins' calls alone", { plugins: [asker] }, async ($, on) => {
  const sent = model(on)

  await $.command.run(lab('free on'))
  const free = await $.command.run(lab('model.complete Say hello'))
  const theirs = await $.command.run(slash('ask', 'their question'))
  await $.command.run(lab('free off'))
  await $.command.run(lab('model.complete Say hello'))
  const report = await $.command.run(lab('spend'))

  expect(free.text).toContain('Free mode')
  expect(theirs.text).toBe('reply-m1')
  expect(sent.map(one => one.prompt)).toEqual(['their question', 'Say hello'])
  // The free call carried no usage: only the call after free mode reached the stand-in model.
  expect(report.text).toContain('mod-lab: 2 calls, 0 sent; in 11, out 7')
  expect(report.text).toContain('asker: 1 call, 0 sent; in 11, out 7')
})

test('a call counts as sent when its chain reached the core tier, where the engine sends it', () => {
  const settled = (trace: { tier: string }[]) => spendCall({ event: 'model.complete', plugin: 'p', e: { model: 'haiku' }, trace, result: { value: 'label-l1' }, at: 0, ms: 1 })

  expect(settled([{ tier: 'user' }, { tier: 'core' }]).isSent).toBe(true)
  expect(settled([{ tier: 'user' }]).isSent).toBe(false)
  expect(settled([]).isSent).toBe(false)
  expect(settled([]).usage).toBeNull()
  expect(settled([]).isAnswered).toBe(true)
})

test('totals add each call to its plugin and outlast the calls kept', () => {
  const call = (plugin: string, input: number) => ({ at: 1, event: 'model.complete', plugin, model: 'haiku', isSent: true, isAnswered: true, usage: { input, output: 1, cacheRead: 2, cacheWrite: 3 }, ms: 4 })
  let spend = EMPTY_SPEND
  for (let index = 0; index < 205; index += 1) spend = addSpend(spend, call(index % 2 === 0 ? 'a' : 'b', 10))

  expect(spend.calls).toHaveLength(200)
  expect(spend.calls.at(-1)?.seq).toBe(205)
  expect(spend.totals.a).toEqual({ calls: 103, sent: 103, input: 1_030, output: 103, cacheRead: 206, cacheWrite: 309 })
  expect(spend.totals.b?.calls).toBe(102)
})
