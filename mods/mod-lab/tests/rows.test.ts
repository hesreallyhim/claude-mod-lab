import { expect, mock, test } from 'claude-code/testing'

import { emptyOf, readerOf, rowOf } from '../hooks/rows'
import { lab } from './kit'

test("a note is kept as a hidden row for the model, and a notice as a line for the person", async ($, on) => {
  const session = mock.session(on)

  await $.command.run(lab('note note-n1 for the model'))
  await $.command.run(lab('notice notice-n2 for the person'))
  const report = await $.command.run(lab('rows'))

  expect(session.appended().map(row => [row.door, row.message.type])).toEqual([
    ['note', 'user'],
    ['note', 'system'],
  ])
  expect(report.text).toContain('for model: note-n1 for the model')
  expect(report.text).toContain('for person: notice-n2 for the person')
})

test('a row a hook beneath the lab changed is marked as rewritten', async ($, on) => {
  on('session.append', ($, e, next) => next({ ...e, message: { ...e.message, content: [{ type: 'text', text: 'changed-c1' }] } } as never))

  await $.command.run(lab('note original-o1'))
  const report = await $.command.run(lab('rows'))

  expect(report.text).toContain('rewritten beneath the lab: changed-c1')
})

test('who reads a row follows its type and door', () => {
  expect(readerOf('system', 'notice', false)).toBe('person')
  expect(readerOf('system', 'note', false)).toBe('person')
  expect(readerOf('system', 'command', false)).toBe('both')
  expect(readerOf('user', 'note', true)).toBe('model')
  expect(readerOf('user', 'hook-context', false)).toBe('model')
  expect(readerOf('user', 'prompt', false)).toBe('both')
  expect(readerOf('assistant', 'response', false)).toBe('both')
})

test("a response's thinking and tool_use blocks count and preview, and the attachment or notice name and the uuid are carried", () => {
  const sent = { door: 'response', origin: { kind: 'model', model: 'claude-opus-5-5' }, uuid: 'row-u1' }
  const thought = { type: 'assistant', content: [{ type: 'thinking', thinking: 'first I read the file', signature: 'sig' }] }
  const call = { type: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] }
  const thinking = rowOf({ ...sent, message: thought } as never, thought as never, 1)
  const toolUse = rowOf({ ...sent, message: call } as never, call as never, 2)
  expect([thinking.chars, thinking.preview, thinking.uuid, thinking.name]).toEqual([21, 'first I read the file', 'row-u1', null])
  expect([toolUse.chars, toolUse.preview]).toEqual([21, 'Bash {"command":"ls"}'])

  const attached = { type: 'attachment', name: 'credential_org', content: [] }
  const row = rowOf({ door: 'attachment', origin: { kind: 'engine' }, uuid: 'row-u2', message: attached } as never, attached as never, 3)
  expect([row.chars, row.preview, row.name, row.blocks]).toEqual([0, '', 'credential_org', []])
})

test('an empty row is described by what it is', () => {
  expect(emptyOf({ door: 'attachment', type: 'attachment', name: 'credential_org', blocks: [] })).toBe('(attachment credential_org, nothing rendered for the model)')
  expect(emptyOf({ door: 'hook-context', type: 'user', name: null, blocks: [] })).toBe('(a hook that added nothing for the model)')
  expect(emptyOf({ door: 'notice', type: 'system', name: 'stop_hook_summary', blocks: [] })).toBe('(a stop_hook_summary notice with no text)')
  expect(emptyOf({ door: 'response', type: 'assistant', name: null, blocks: ['image'] })).toBe('(image)')
  expect(emptyOf({ door: 'prompt', type: 'user', name: null, blocks: [] })).toBe('(no content on the row)')
})
