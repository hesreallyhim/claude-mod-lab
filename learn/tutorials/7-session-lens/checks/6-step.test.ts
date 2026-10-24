import { expect, test } from 'claude-code/testing'
import { apiMessage, desk, NOTE } from './kit'

test('the first main model step records the normalized view and relays the stream and result', async ($, on) => {
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'synthetic answer', ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: 'synthetic answer', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const { text, reads } = await desk($, on, { api: [apiMessage(NOTE)] })
  const stream = $.turn.step({ turnId: 'first-turn', index: 0, model: 'test-model', messageCount: 1 })
  const first = await stream.next()
  const last = await stream.next()
  expect(first.value).toMatchObject({ kind: 'text', text: 'synthetic answer' })
  expect(last.done).toBe(true)
  expect(last.value).toMatchObject({ answer: 'synthetic answer', turnId: 'first-turn' })
  expect(reads).toEqual(['api'])
  expect(await text()).toContain('Turn first-turn, step 1')
  expect(await text()).toContain('Step API messages: 1 messages; note found; notice not found')
})

test('later steps and subagents do not replace the first main-step observation', async ($, on) => {
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const { text, reads } = await desk($, on, { api: [apiMessage(NOTE)] })
  for (const args of [
    { turnId: 'main-turn', index: 0 },
    { turnId: 'main-turn', index: 1 },
    { turnId: 'agent-turn', index: 0, agentId: 'agent-1' },
  ]) {
    for await (const chunk of $.turn.step({ ...args, model: 'test-model', messageCount: 1 })) void chunk
  }
  expect(reads).toEqual(['api'])
  expect(await text()).toContain('Turn main-turn, step 1')
  expect(await text()).not.toContain('Turn agent-turn')
})
