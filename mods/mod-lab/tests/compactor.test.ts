import { expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { SessionCompactInput, SessionMessage } from 'claude-code'

import { SUMMARY_MARK, tailStart } from '../hooks/compactor'
import { lab, TEST } from './kit'

let handles = 0
function message(role: SessionMessage['role'], text: string, extra: Partial<SessionMessage> = {}): SessionMessage {
  handles += 1
  return { role, text, toolUses: [], handle: `handle-${handles}`, ...extra }
}
const calls = (tool: string, id: string) => message('assistant', '', { toolUses: [{ tool_use_id: id, tool, input: { id } }] })
const answers = (id: string) => message('user', '', { toolResults: [{ tool_use_id: id, text: `result-${id}`, isError: false }] })

// Two prompts, four replies, three tool calls; the last message but one is a tool result.
const conversation: SessionMessage[] = [
  message('user', 'first-f1'),
  calls('Read', 'r1'),
  answers('r1'),
  calls('Bash', 'b1'),
  answers('b1'),
  message('assistant', 'done-d1'),
  message('user', 'second-p2'),
  calls('Read', 'r2'),
  answers('r2'),
  message('assistant', 'last-l9'),
]

function compaction(trigger: SessionCompactInput['trigger'], extra: Partial<SessionCompactInput> = {}): SessionCompactInput {
  return { trigger, messages: conversation, ...extra }
}

test('while the compactor is on, a compaction keeps the first message and the last few, the lab\'s summary between, and reaches no summarizer', async ($, on) => {
  let reached = 0
  on('session.compact', () => {
    reached += 1
    return { skip: 'the test stands in for the summarizer' }
  })

  await $.command.run(lab('compactor keep 3'))
  const result = await $.session.compact(compaction('manual'))
  const report = await $.command.run(lab('compactor'))

  const tail = conversation.slice(-3)
  expect(reached).toBe(0)
  expect(result.messages?.map(one => one.handle)).toEqual([conversation[0]?.handle, undefined, ...tail.map(one => one.handle)])
  const summary = result.messages?.[1]?.text ?? ''
  expect(summary.startsWith(`${SUMMARY_MARK} ${conversation.length - 1 - tail.length} earlier messages were removed`)).toBe(true)
  expect(summary).toContain('They held 1 message from the user, 3 from the assistant, and 2 tool calls (Read 1, Bash 1).')
  expect(summary).toContain(`kept above this one and was answered in the removed messages; the last ${tail.length} messages are kept below it`)
  expect(report.text).toContain(`manual, by mod-lab: ${conversation.length} messages to ${tail.length + 2}`)
  expect(report.text).toContain('no model call')
})

test('the kept tail never starts with a tool result whose call was dropped', async ($, on) => {
  on('session.compact', () => ({ skip: 'not reached' }))

  await $.command.run(lab('compactor keep 2'))
  const result = await $.session.compact(compaction('manual'))

  expect(tailStart(conversation, 2)).toBe(conversation.length - 1)
  expect(result.messages?.at(-1)?.text).toBe('last-l9')
  expect(result.messages?.some(one => (one.toolResults ?? []).length > 0)).toBe(false)
})

test('the kept tail starts where a response starts, when the engine split it into messages', () => {
  // A response with thinking: a message with no text, then its text.
  const split = [message('user', 'first-f2'), message('assistant', ''), message('assistant', 'reply-r1'), message('user', 'second-p3'), message('assistant', ''), message('assistant', 'reply-r2')]

  expect(tailStart(split, 1)).toBe(split.length - 2)
})

test('instructions the lab cannot follow are passed on in its summary, said to be unapplied', async ($, on) => {
  on('session.compact', () => ({ skip: 'not reached' }))

  await $.command.run(lab('compactor keep 3'))
  const result = await $.session.compact(compaction('manual', { instructions: 'keep-k1 the plan' }))

  expect(result.messages?.[1]?.text).toContain('given these instructions: "keep-k1 the plan". No model read the removed messages')
})

test('with the compactor off, a compaction passes on and is kept with who answered it and what the summarizer cost', async ($, on) => {
  const usage = { input_tokens: 100, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 900, output_tokens: 300 }
  on('session.compact', ($, e) => ({ messages: [{ role: 'user', text: 'summary-s1', toolUses: [] }, e.messages.at(-1) as SessionMessage], tokensBefore: 9_000, tokensAfter: 1_200, usage }))

  const result = await $.session.compact(compaction('auto'))
  const report = await $.command.run(lab('compactor'))

  expect(result.messages?.[0]?.text).toBe('summary-s1')
  expect(report.text).toContain("The lab's compactor is off")
  expect(report.text).toContain(`auto, by ${TEST}: ${conversation.length} messages to 2; 9,000 tokens to 1,200, by the engine's count; the summarizer read 9,000 tokens and wrote 300`)
})

test("a precompute is skipped while the compactor is on, and a subagent's compaction is left to the engine", async ($, on) => {
  const reached: SessionCompactInput[] = []
  on('session.compact', ($, e) => {
    reached.push(e)
    return { skip: 'the test stands in for the summarizer' }
  })

  await $.command.run(lab('compactor keep 3'))
  const ahead = await $.session.compact(compaction('precompute'))
  await $.session.compact(compaction('auto', { agentId: 'agent-a1' }))

  expect(ahead.skip).toContain('compacts on its own')
  expect(reached.map(one => one.agentId)).toEqual(['agent-a1'])
})

test('the size before is the last request\'s input, and the size after is measured at the next request', async ($, on) => {
  on('session.compact', () => ({ skip: 'not reached' }))
  on('session.usage', () => ({ value: { context: { tokens: 31_000, window: 200_000 }, rateLimits: [], startedAt: 0 } }) as never)
  const usage = { input_tokens: 50, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 950, output_tokens: 10, model: 'model-m1' }
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'answer-a1', toolUses: [], stopReason: 'end_turn', usage }
  })

  await $.command.run(lab('compactor keep 3'))
  await $.session.compact(compaction('manual'))
  const waiting = await $.command.run(lab('compactor'))
  for await (const chunk of $.turn.step({ turnId: 'turn-t1', index: 0, model: 'model-m1', messageCount: 5 })) void chunk
  const measured = await $.command.run(lab('compactor'))

  expect(waiting.text).toContain("a request's whole input 31,000 tokens before, a size the next request will measure after")
  const after = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  expect(measured.text).toContain(`31,000 tokens before, ${after.toLocaleString('en-US')} after`)
})

/** Another plugin that asks the lab to compact as a turn ends, between turns as the explorer bridge's timer does, and shows the answer. */
const bridge: Plugin = {
  name: 'bridge-like',
  register(on) {
    on('turn.complete', async ($, e, next) => {
      await next(e)
      return { text: await $.lab.command({ text: 'compact keep-k2 the tests' }) }
    })
  },
}

test('compacting through $.lab.command reaches the hooks beneath with the instructions given, and says it is not undone', { plugins: [bridge] }, async ($, on) => {
  const reached: SessionCompactInput[] = []
  on('session.compact', ($, e) => {
    reached.push(e)
    return { messages: [{ role: 'user', text: 'summary-s2', toolUses: [] }] }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  const { text: answer } = await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'turn-t2' } as never)

  // The kit raises a plugin's call with its arguments alone; a session adds the trigger and the messages.
  expect(reached.map(one => one.instructions)).toEqual(['keep-k2 the tests'])
  expect(answer.startsWith('Compacted')).toBe(true)
  expect(answer).toContain('not undone')
})

test('/mod-lab compact typed is refused by the engine, and the answer points to /compact', async ($, on) => {
  const reached: SessionCompactInput[] = []
  on('session.compact', ($, e) => {
    reached.push(e)
    return { skip: 'not reached' }
  })

  const answer = await $.command.run(lab('compact'))

  expect(reached).toEqual([])
  expect(answer.text?.startsWith('Not compacted: ')).toBe(true)
  expect(answer.text).toContain('Type /compact instead')
})

test('a setting out of range is refused with the usage', async $ => {
  const answer = await $.command.run(lab('compactor keep 0'))
  const status = await $.command.run(lab('compactor'))

  expect(answer.text).toContain('Use /mod-lab compactor keep <n>')
  expect(status.text).toContain("The lab's compactor is off")
})
