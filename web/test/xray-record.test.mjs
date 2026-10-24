import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordSections } from '../public/xray-record.js'

test('full message strings, thinking and tool inputs are primary content without truncation', () => {
  const full = 'A long message\n'.repeat(50)
  assert.deepEqual(recordSections({ type: 'user', uuid: 'u', message: { content: full } }), [
    { label: 'Message', value: full },
  ])
  assert.deepEqual(
    recordSections({
      message: {
        content: [
          { type: 'thinking', thinking: full },
          { type: 'tool_use', name: 'Read', input: { path: '/project/README.md' } },
          { type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'File missing' }] },
        ],
      },
    }),
    [
      { label: 'Thinking', value: full },
      { label: 'Tool call: Read', value: { path: '/project/README.md' } },
      { label: 'Tool result (error)', value: [{ type: 'text', text: 'File missing' }] },
    ],
  )
})

test('attachments and system event payloads are visible without opening the raw record', () => {
  const attachment = {
    type: 'skill_listing',
    content: 'Full skill descriptions',
    skillCount: 14,
    names: Array.from({ length: 14 }, (_, i) => `skill-${i}`),
  }
  const rendered = [{ content: 'The model rendering' }]
  assert.deepEqual(recordSections({ type: 'attachment', uuid: 'u', attachment, rendered }), [
    { label: 'Attachment content', value: attachment.content },
    {
      label: 'Attachment details',
      value: { type: attachment.type, skillCount: attachment.skillCount, names: attachment.names },
    },
    { label: 'Model-visible content', value: 'The model rendering' },
  ])
  assert.deepEqual(recordSections({ type: 'system', subtype: 'turn_duration', durationMs: 1234, messageCount: 5 }), [
    { label: 'Duration (ms)', value: 1234 },
    { label: 'Message count', value: 5 },
  ])
  const hookInfos = [{ name: 'format', output: 'Formatted 3 files' }]
  assert.ok(recordSections({ type: 'system', hookCount: 1, hookInfos }).some(part => part.value === hookInfos))
  const data = { text: 'Unexpected but useful nested content' }
  assert.deepEqual(recordSections({ type: 'new-record-type', data }), [{ label: 'Data', value: data }])
})

test('metadata stays secondary, but unfamiliar content blocks remain available', () => {
  assert.deepEqual(recordSections({ uuid: 'u', type: 'system', timestamp: 'now', sessionId: 's' }), [])
  const image = { type: 'image', source: { type: 'base64', data: 'example' } }
  assert.deepEqual(recordSections({ message: { content: [image, null, 'plain text'] } }), [
    { label: 'Content block 1', value: image },
    { label: 'Content block 2', value: null },
    { label: 'Message', value: 'plain text' },
  ])
})

test('attachment text is presented once even when rendered content repeats it', () => {
  const content = 'Full attachment content'.repeat(40)
  const parts = recordSections({
    uuid: 'u',
    type: 'attachment',
    apiBlockIndex: 2,
    requestRef: 'r',
    entrypoint: 'cli',
    gitBranch: 'main',
    session_id: 's',
    attachment: { type: 'skill_listing', content, skillCount: 3 },
    rendered: [{ content }],
  })
  assert.deepEqual(parts, [
    { label: 'Attachment content', value: content },
    { label: 'Attachment details', value: { type: 'skill_listing', skillCount: 3 } },
  ])
})

test('intentional repeated message blocks are preserved', () => {
  const block = { type: 'text', text: 'repeat' }
  assert.deepEqual(recordSections({ message: { content: [block, block] } }), [
    { label: 'Message', value: 'repeat' },
    { label: 'Message', value: 'repeat' },
  ])
})
