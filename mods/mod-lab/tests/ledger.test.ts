import type { Plugin } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { blocksAddedBy, contextAddedBy, formatLedger } from '../hooks/ledger'
import { lab, recordState } from './kit'

test('a line first received by a link was added by the link above it', () => {
  const trace = [
    { plugin: 'first', received: { context: ['typed'] } },
    { plugin: 'second', received: { context: ['typed', 'from first k1'] } },
    { plugin: 'engine', received: { context: ['typed', 'from first k1', 'from second k2'] } },
  ]

  const added = contextAddedBy(['typed'], trace)

  expect([...added]).toEqual([
    ['first', ['from first k1']],
    ['second', ['from second k2']],
  ])
})

test('a block one link answers with and the link beneath did not was added on the way back up', () => {
  const engine = { blocks: [{ name: 'currentDate', text: 'today' }] }
  const trace = [
    { plugin: 'notes', received: engine, returned: { blocks: [...engine.blocks, { name: 'notes', text: 'remember b3' }] } },
    { plugin: 'engine', received: engine, returned: engine },
  ]

  const added = blocksAddedBy(engine.blocks, trace)

  expect([...added]).toEqual([['notes', [{ name: 'notes', text: 'remember b3' }]]])
})

test("the report sets a plugin's sections and tools apart from the engine's, at the system prompt's measured rate", () => {
  // 40 characters of system prompt measured at 8 tokens: 5 characters a token.
  const report = formatLedger({
    categories: [{ name: 'System prompt', tokens: 8, kind: 'used' }],
    sections: [
      { id: 'intro', scope: 'shared', text: 'x'.repeat(30) },
      { id: 'mine-s4:rules', scope: 'session', text: 'y'.repeat(10) },
    ],
    tools: [],
    ledger: {
      prompts: 2,
      promptContext: { 'mine-s4': { count: 2, chars: 10, at: 0, preview: 'branch' } },
      contextBlocks: {},
      attachments: {},
      tools: {
        Read: { provider: 'engine', isDeferred: false, chars: 40 },
        'mcp__mine-s4__total': { provider: 'mine-s4', isDeferred: false, chars: 15 },
        mcp__mail__send: { provider: 'mcp:mail', isDeferred: true, chars: 99 },
      },
    },
  })

  expect(report).toContain('5.0 characters a token')
  expect(report).toMatch(/engine +1 section +≈ 6 tokens/)
  expect(report).toMatch(/mine-s4 +1 section +≈ 2 tokens +mine-s4:rules \(session\)/)
  expect(report).toMatch(/engine +1 tool +≈ 8 tokens/)
  expect(report).toMatch(/mine-s4 +1 tool +≈ 3 tokens/)
  expect(report).toContain('mcp:mail 1')
  expect(report).toMatch(/mine-s4 +≈ 2 tokens, on 2 prompts so far +"branch"/)
})

/** A plugin that adds a line of context to every prompt, as a mod at prompt.submit does. */
const adder: Plugin = {
  name: 'adder',
  register(on) {
    on('prompt.submit', ($, e, next) => next({ ...e, context: [...(e.context ?? []), 'added by adder a5'] }))
  },
}

test('/mod-lab ledger names the plugin that added context to the latest prompt', { plugins: [adder] }, async ($, on) => {
  const clock = mock.clock(on)
  recordState(on)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
  on('session.usage', () => ({ value: { context: { window: 1000, breakdown: { categories: [] } }, rateLimits: [], startedAt: 0 } }) as never)
  on('prompt.compose', () => ({ sections: [] }))
  on('tool.list', () => ({ value: [] }))

  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const report = await $.command.run(lab('ledger'))

  expect(report.text).toMatch(/adder +≈ \d+ tokens, on 1 prompt so far +"added by adder a5"/)
})
