import { expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { ProcessSpawnChunk, ProcessSpawnRequest } from 'claude-code'

import { streamOf } from '../hooks/streams'
import { lab, lastRun, recordState, slash, TEST } from './kit'

const pieces: ProcessSpawnChunk[] = [
  { stream: 'stdout', text: 'piece-p1 ' },
  { stream: 'stderr', text: 'piece-p2\n' },
  { stream: 'stdout', text: 'piece-p3\n' },
]

/** Another plugin whose /spawn starts a child and answers what it read, or why it could not. */
const spawner: Plugin = {
  name: 'spawner',
  register(on) {
    on('command.run', { command: 'spawn' }, async ($, e) => {
      let read = ''
      try {
        for await (const chunk of $.process.spawn({ argv: ['echo', e.args] })) read += chunk.text
        return { text: `read: ${read}` }
      } catch (error) {
        return { text: `refused: ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  },
}

test("the spawn probe keeps each piece of the child's output in order, with how it ended and how many passed", async ($, on) => {
  const recorded = recordState(on)
  on('process.spawn', async function* () {
    for (const piece of pieces) yield piece
    return { value: { code: 0, signal: null } }
  })

  await $.command.run(lab('process.spawn'))

  const run = lastRun(recorded)
  const value = run?.value as { code: number; chunks: { stream: string; text: string }[] }
  expect(run?.ok).toBe(true)
  expect(value.code).toBe(0)
  expect(value.chunks.map(chunk => [chunk.stream, chunk.text])).toEqual(pieces.map(piece => [piece.stream, piece.text]))
  expect(run?.dispatches[0]).toMatchObject({ event: 'process.spawn', returned: { value: { code: 0 }, chunks: pieces.length } })
  expect(run?.dispatches[0]?.chain).toMatchObject([{ plugin: TEST, outcome: 'returned' }])
})

test("a watch on process.spawn keeps another plugin's spawn as a tap and passes every piece on", { plugins: [spawner] }, async ($, on) => {
  const recorded = recordState(on)
  on('process.spawn', async function* () {
    for (const piece of pieces) yield piece
    return { value: { code: 0, signal: null } }
  })

  await $.command.run(lab('intercept process.spawn watch'))
  const answer = await $.command.run(slash('spawn', 'hello-h1'))

  expect(answer.text).toBe(`read: ${pieces.map(piece => piece.text).join('')}`)
  const tap = recorded.taps.at(-1)?.at(-1)
  expect(tap).toMatchObject({ event: 'process.spawn', origin: 'spawner', behavior: 'watch', returned: { chunks: pieces.length } })
})

test("a refusal rejects the other plugin's stream, and no child starts", { plugins: [spawner] }, async ($, on) => {
  const started: ProcessSpawnRequest[] = []
  on('process.spawn', async function* ($, e) {
    started.push(e)
    return { value: { code: 0, signal: null } }
  })

  await $.command.run(lab('intercept process.spawn refuse others'))
  const answer = await $.command.run(slash('spawn', 'hello-h2'))

  expect(answer.text?.startsWith('refused: ')).toBe(true)
  expect(answer.text).toContain("mod-lab intercepted spawner's process.spawn and refused it")
  expect(started).toEqual([])
})

test('the other behaviors are refused on process.spawn, which streams', async $ => {
  const answer = await $.command.run(lab('intercept process.spawn delay 100'))

  expect(answer.text).toBe('process.spawn streams: the lab can watch or refuse it')
})

test("a model request's trace row keeps when each kind of chunk arrived", async ($, on) => {
  const recorded = recordState(on)
  const chunks = [
    { kind: 'thinking', index: 0, text: 'thought-t1', ref: 1 },
    { kind: 'text', index: 1, text: 'answer-a1', ref: 2 },
    { kind: 'text', index: 1, text: ' answer-a2', ref: 3 },
  ] as const
  on('turn.step', async function* ($, e) {
    for (const chunk of chunks) yield chunk
    return { turnId: e.turnId, index: e.index, answer: 'answer-a1 answer-a2', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  for await (const chunk of $.turn.step({ turnId: 'turn-t1', index: 0, model: 'model-m1', messageCount: 3 })) void chunk

  const row = recorded.traces.at(-1)?.at(-1)
  expect(row?.stream?.kinds).toMatchObject({ thinking: { count: 1 }, text: { count: 2 } })
  expect(row?.stream?.arrivals.reduce((sum, count) => sum + count, 0)).toBe(chunks.length)
  expect(row?.summary).toContain('thinking 1, text 2')
})

test("a stream's brief counts each kind, and spreads arrivals over slices of its time", () => {
  const arrivals = [
    { kind: 'text', ms: 100 },
    { kind: 'text', ms: 150 },
    { kind: 'tool', ms: 990 },
  ]

  const stream = streamOf(arrivals, 1_000)

  expect(stream.first).toBe(100)
  expect(stream.kinds).toEqual({ text: { count: 2, first: 100, last: 150 }, tool: { count: 1, first: 990, last: 990 } })
  expect(stream.arrivals.reduce((sum, count) => sum + count, 0)).toBe(arrivals.length)
  expect(stream.arrivals.at(-1)).toBe(1)
  expect(streamOf([], 500).first).toBe(null)
})
