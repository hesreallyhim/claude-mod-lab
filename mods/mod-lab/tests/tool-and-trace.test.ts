import { expect, mock, test } from 'claude-code/testing'

import { lab, lastRun, read, reader, recordState } from './kit'

const textOf = (answer: object) => ('result' in answer ? String(answer.result) : '')

test("the model's tool runs a probe and answers with the run as text", async ($, on) => {
  const clock = mock.clock(on, { now: 7_654_321 })
  const recorded = recordState(on)

  const answer = await $.tool.call({ tool: 'mcp__mod-lab__probe', probe: 'clock.now' })

  const text = 'result' in answer ? String(answer.result) : ''
  expect(text).toContain(`"now": ${clock.now()}`)
  expect(text).toContain('clock.now({})')
  expect(lastRun(recorded)).toMatchObject({ probe: 'clock.now', from: 'tool', ok: true })
  expect(lastRun(recorded)?.dispatches.map(dispatch => dispatch.event)).toEqual(['clock.now'])
})

test('a prompt is recorded in the trace with a summary and its chain, until tracing is paused', async ($, on) => {
  const clock = mock.clock(on)
  const recorded = recordState(on)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
  const submit = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  await submit('first prompt w8')
  await clock.settle()

  const rows = recorded.traces.at(-1) ?? []
  expect(rows.at(-1)).toMatchObject({ event: 'prompt.submit', summary: '"first prompt w8"' })
  expect(rows.at(-1)?.chain.map(link => link.plugin)).toEqual(['test'])

  await $.command.run(lab('trace off'))
  await submit('second prompt w9')
  await clock.settle()

  const after = recorded.traces.at(-1) ?? []
  expect(after.some(row => row.summary.includes('second prompt w9'))).toBe(false)
})

test('a model request is traced with what it answered, and its stream passes through untouched', async ($, on) => {
  const clock = mock.clock(on)
  const recorded = recordState(on)
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'chunk-s1', ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: 'answer-s2', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  const stream = $.turn.step({ turnId: 'turn-s3', index: 0, model: 'model-s4', messageCount: 7 })
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  await clock.settle()

  expect(chunks).toMatchObject([{ kind: 'text', text: 'chunk-s1' }])
  const row = recorded.traces.at(-1)?.at(-1)
  expect(row).toMatchObject({ event: 'turn.step', summary: expect.stringContaining('request 1, 7 messages, model-s4 -> "answer-s2"') })
  expect(row?.input).toMatchObject({ turnId: 'turn-s3' })
})

test('the runs tool answers the runs the lab kept, with what each dispatched and its chain, and runs nothing itself', async ($, on) => {
  on('session.cwd', () => ({ value: '/work/r7' }))
  const recorded = recordState(on)
  await $.command.run(lab('session.cwd'))
  const writes = recorded.runs.length

  const brief = textOf(await $.tool.call({ tool: 'mcp__mod-lab__runs' }))
  const full = textOf(await $.tool.call({ tool: 'mcp__mod-lab__runs', seq: lastRun(recorded)?.seq }))

  expect(brief).toContain('session.cwd')
  expect(brief).toContain('/work/r7')
  expect(brief).toMatch(/chain: test/)
  expect(full).toContain('return $.session.cwd()')
  expect(recorded.runs).toHaveLength(writes)
})

test('the trace tool answers the newest session events that fit its bound', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
  for (let index = 1; index <= 120; index += 1) {
    await $.prompt.submit({ text: `prompt t${index}: ${'words '.repeat(40)}`, wait: false, origin: { kind: 'composer' } })
  }
  await clock.settle()

  const answer = textOf(await $.tool.call({ tool: 'mcp__mod-lab__trace', last: 100 }))

  // Some two thousand tokens at most, however many events are asked for.
  expect(answer.length).toBeLessThan(10_000)
  expect(answer).toContain('prompt t120:')
  expect(answer).not.toContain('prompt t21:')
})

test("the intercepts tool answers the intercepts in force and the calls they acted on, one event's when asked", { plugins: [reader] }, async ($, on) => {
  on('fs.read', ($, e) => ({ value: `text of ${e.path}` }))
  const clock = mock.clock(on)
  await $.command.run(lab('intercept fs.read watch others'))
  await $.command.run(lab('intercept fs.stat refuse'))
  await $.command.run(read('/work/seen-i5.md'))
  await clock.settle()

  const all = textOf(await $.tool.call({ tool: 'mcp__mod-lab__intercepts' }))
  const one = textOf(await $.tool.call({ tool: 'mcp__mod-lab__intercepts', event: 'fs.stat' }))
  await $.command.run(lab('intercept clear'))

  expect(all).toContain('fs.read watch')
  expect(all).toContain('fs.stat refuse')
  expect(all).toMatch(/reader fs\.read\(.*seen-i5\.md/)
  expect(one).toContain('fs.stat refuse')
  expect(one).not.toContain('fs.read')
})

test("the lesson tool answers the current lesson and its last checker report from the workspace's state, and says when there is none", async ($, on) => {
  const state = {
    current: 'tick',
    lessons: {
      tick: { passed: 1, total: 3, at: Date.UTC(2026, 9, 20, 12), report: 'tick: A stopwatch you can click\n  ✗ 2. Count a click' },
      egg: { passed: 2, total: 2, at: Date.UTC(2026, 9, 19), report: 'egg: done' },
    },
  }
  let file: string | null = JSON.stringify(state)
  const asked: string[] = []
  on('fs.read', ($, e) => {
    asked.push(e.path)
    return file === null ? { deny: 'ENOENT: no such file' } : { value: file }
  })

  const answer = textOf(await $.tool.call({ tool: 'mcp__mod-lab__lesson' }))
  file = null
  const none = textOf(await $.tool.call({ tool: 'mcp__mod-lab__lesson' }))

  // Read from the session's folder, as the engine resolves a relative path.
  expect(asked).toHaveLength(2)
  expect(asked.every(path => path.endsWith('/.claude-mod-lab/progress.json'))).toBe(true)
  expect(answer).toContain('The current lesson: tick.')
  expect(answer).toContain('1 of 3 checked steps pass')
  expect(answer).toContain('✗ 2. Count a click')
  expect(answer).toContain('egg 2/2')
  expect(none).toContain('No lesson has been opened or checked')
})
