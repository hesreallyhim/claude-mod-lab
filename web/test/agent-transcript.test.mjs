import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentTranscriptView } from '../public/agent-transcript.js'

class Element {
  constructor(tag) {
    this.tag = tag
    this.attrs = {}
    this.children = []
    this.events = new Map()
    this.open = false
    this.focused = false
  }
  append(...children) {
    this.children.push(...children)
  }
  setAttribute(name, value) {
    this.attrs[name] = value
  }
  set className(value) {
    this.attrs.class = value
  }
  get id() {
    return this.attrs.id
  }
  remove() {
    this.removed = true
  }
  addEventListener(name, handler) {
    this.events.set(name, handler)
  }
  querySelector(tag) {
    return this.find(node => node.tag === tag)[0] ?? null
  }
  find(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap(child => (child instanceof Element ? child.find(predicate) : [])),
    ]
  }
  get text() {
    return this.children.map(child => (child instanceof Element ? child.text : String(child))).join('')
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
  }
  focus() {
    this.focused = true
  }
  getBoundingClientRect() {
    return { left: 100, right: 800, top: 100, bottom: 700 }
  }
}

function install(t) {
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis))
  const previous = { Node: scope.Node, document: scope.document }
  scope.Node = Element
  const body = new Element('body')
  scope.document = { body, createElement: tag => new Element(tag), createTextNode: text => String(text) }
  t.after(() => Object.assign(scope, previous))
  return body
}

function transcript(messages, extra = {}) {
  return agentTranscriptView(
    JSON.stringify({ kind: 'agent-transcript', version: 1, agentId: 'a1', messages, ...extra }),
    'a1',
  )
}

test('tool calls and responses have meaningful labels and preserve message order', t => {
  install(t)
  const view = transcript([
    { role: 'user', text: 'Count the files.' },
    {
      role: 'assistant',
      toolUses: [{ tool_use_id: 'one', tool: 'Bash', input: { command: 'find docs -name "*.md"', timeout: 1000 } }],
    },
    { role: 'user', toolResults: [{ tool_use_id: 'one', text: '12' }] },
    { role: 'assistant', text: 'There are 12 files.' },
  ])
  assert.deepEqual(
    view.find(node => node.tag === 'h3').map(node => node.text),
    ['User', 'Tool call · Bash', 'Tool result · Bash', 'Assistant'],
  )
  assert.match(view.text, /command.*find docs.*timeout.*1000/)
  assert.ok(!view.text.includes('No result recorded'))
  assert.equal(view.find(node => node.attrs.class === 'json-inline').length, 0)
})

test('explicit results win over attached results and duplicate ids display only once', t => {
  install(t)
  const view = transcript([
    { role: 'assistant', toolUses: [{ tool_use_id: 'one', tool: 'Bash', input: {}, text: 'attached output' }] },
    { role: 'assistant', text: 'Intervening message' },
    {
      role: 'user',
      toolResults: [
        { tool_use_id: 'one', text: 'explicit output' },
        { tool_use_id: 'one', text: 'duplicate output' },
      ],
    },
  ])
  assert.equal(view.find(node => node.attrs.class === 'transcript-result').length, 1)
  assert.match(view.text, /Intervening message.*explicit output/)
  assert.ok(!view.text.includes('attached output'))
  assert.ok(!view.text.includes('duplicate output'))
})

test('attached results are available when there is no separate tool result row', t => {
  install(t)
  const view = transcript([
    {
      role: 'assistant',
      toolUses: [{ tool_use_id: 'one', tool: 'Bash', input: {}, text: 'file.md', result: { exitCode: 0 } }],
    },
  ])
  assert.match(view.text, /Tool call · Bash.*Tool result · Bash.*file.md.*exitCode.*0/)
})

test('empty output, missing output, errors, and unmatched results are distinguished', t => {
  install(t)
  const view = transcript([
    {
      role: 'assistant',
      toolUses: [
        { tool_use_id: 'empty', tool: 'Bash', input: {}, text: '' },
        { tool_use_id: 'pending', tool: 'Read' },
      ],
    },
    { role: 'user', toolResults: [{ tool_use_id: 'orphan', text: 'Permission denied', isError: true }] },
  ])
  assert.match(view.text, /Tool result · BashNo text output/)
  assert.match(view.text, /Tool call · ReadInput was not recorded.No result recorded/)
  assert.match(view.text, /Tool result · Unknown toolErrorCall ID: orphanPermission denied/)
})

test('empty messages do not create blank role headings or invent thinking content', t => {
  install(t)
  const view = transcript([
    { role: 'assistant', text: '' },
    { role: 'user', text: '   ' },
    { role: 'assistant', text: 'Done' },
  ])
  assert.deepEqual(
    view.find(node => node.tag === 'h3').map(node => node.text),
    ['Assistant'],
  )
  assert.match(view.text, /2 messages contained no available text or tool data/)
  assert.ok(!view.text.includes('thinking'))
  assert.match(transcript([]).text, /No transcript messages were recorded/)
  assert.match(transcript([], { error: 'Agent no longer available.' }).text, /Agent no longer available/)
})

test('complete long messages and tool output are preserved behind bounded previews', t => {
  const body = install(t)
  const text = '<literal> output '.repeat(200)
  const view = transcript([
    { role: 'assistant', text },
    { role: 'user', toolResults: [{ tool_use_id: 'one', text }] },
  ])
  assert.ok(view.text.length < text.length)
  const buttons = view.find(node => node.tag === 'button')
  assert.equal(buttons.length, 2)
  for (const button of buttons) {
    button.events.get('click')()
    assert.equal(body.children.at(-1).querySelector('pre').text, text)
  }
})

test('legacy, malformed, mismatched and unsupported responses show a recovery hint', t => {
  const body = install(t)
  for (const response of [
    '',
    'assistant: \nuser:',
    '{',
    JSON.stringify({ kind: 'agent-transcript', version: 2, agentId: 'a1', messages: [] }),
    JSON.stringify({ kind: 'agent-transcript', version: 1, agentId: 'wrong', messages: [] }),
  ]) {
    assert.match(agentTranscriptView(response, 'a1').text, /Reload the lab plugin/)
  }
  const response = 'old response '.repeat(200)
  const view = agentTranscriptView(response, 'a1')
  assert.ok(view.text.length < response.length)
  view.find(node => node.tag === 'button')[0].events.get('click')()
  assert.equal(body.children.at(-1).querySelector('pre').text, response)
})
