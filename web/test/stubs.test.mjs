import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStubs } from '../lib/stubs.mjs'

// An invented declaration file with the two maps the engine's has: each op event's input and what it resolves to.
const FIXTURE = `
declare module 'claude-code' {
  export type FsBytes = { base64: string }
  export type Entry = { kind: 'file'; name: string; size: number } | { kind: 'dir'; name: string; entries: number }
  export type Pane = { id: string; title?: string; isShown: boolean; onClose: () => void; tags: readonly string[] }
  export type Deep = { a: { b: { c: { d: { e: string } } } } }
  /** A question about a call. All are its identity and are pinned. */
  export type Question = { tool: string; input: string }
  export type OpEventOf = {
    'demo.read': { path: string; as: 'text' | 'bytes' }
    'demo.panes': void
    /** The lookup; \`name\` is pinned. */
    'demo.get': { name: string; fallback: string }
    'demo.ask': Question
    /** \`prompt\` may change; every other key is pinned. */
    'demo.spawn': { prompt: string; model: string; id: string }
    'demo.send': {
      /** Pinned: a rewrite is refused. */
      to: string
      /** What to say. */
      text: string
    }
  }
  export type OpValueOf = {
    'demo.read': string | FsBytes
    'demo.list': Entry[]
    'demo.panes': readonly Pane[]
    'demo.write': void
    'demo.deep': Deep
    'http.fetch': { status: number; ok: boolean; text: string; extra: number }
  }
}
`

const path = join(mkdtempSync(join(tmpdir(), 'mod-lab-stubs-')), 'claude-code.d.ts')
writeFileSync(path, FIXTURE)
const { stubsFor } = createStubs(path)
const values = stubs => stubs.map(stub => [stub.label, JSON.parse(stub.json)])

test('a union of shapes gives one answer per shape; a rewrite is one field of the input, a literal union its first', () => {
  const read = stubsFor('demo.read')
  assert.deepEqual(values(read.answer), [
    ['string', ''],
    ['FsBytes', { base64: '' }],
  ])
  assert.deepEqual(values(read.rewrite), [
    ['path', { path: '' }],
    ['as', { as: 'text' }],
  ])
})

test('an array of a union gives one list per shape, named by the field that tells them apart', () => {
  assert.deepEqual(values(stubsFor('demo.list').answer), [
    ['[kind: "file"]', [{ kind: 'file', name: '', size: 0 }]],
    ['[kind: "dir"]', [{ kind: 'dir', name: '', entries: 0 }]],
  ])
})

test('an object stub has its required data fields: optional ones and functions are left out', () => {
  assert.deepEqual(values(stubsFor('demo.panes').answer), [[null, [{ id: '', isShown: false, tags: [''] }]]])
  // Rewrite merges fields into the input, and demo.panes takes none.
  assert.deepEqual(stubsFor('demo.panes').rewrite, [])
})

test('void answers null; nesting past the depth limit is left empty; an event the maps lack has none', () => {
  assert.deepEqual(values(stubsFor('demo.write').answer), [[null, null]])
  assert.deepEqual(values(stubsFor('demo.deep').answer), [[null, { a: { b: { c: { d: {} } } } }]])
  assert.deepEqual(stubsFor('no.such'), { answer: [], rewrite: [], more: { answer: 0, rewrite: 0 } })
})

test("a revision corrects a stub's values where the types cannot say what they mean, and never adds a field", () => {
  // http.fetch's revision makes a response of 200 ok; the fixture's has no headers, which the revision does not add.
  assert.deepEqual(values(stubsFor('http.fetch').answer), [[null, { status: 200, ok: true, text: '', extra: 0 }]])
})

test("a field the declarations call pinned, in its own description or its event's or type's, is offered for no rewrite", () => {
  const rewritable = event => stubsFor(event).rewrite.map(stub => stub.label)
  assert.deepEqual(rewritable('demo.send'), ['text'])
  assert.deepEqual(rewritable('demo.get'), ['fallback'])
  assert.deepEqual(rewritable('demo.ask'), [])
  assert.deepEqual(rewritable('demo.spawn'), ['prompt'])
  // A stub carries the description of what it stands for, for the form to show.
  assert.equal(stubsFor('demo.send').rewrite[0].doc, 'What to say.')
})
