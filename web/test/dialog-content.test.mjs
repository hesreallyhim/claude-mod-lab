import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jsonTree, logRow, openDataDialog, payloadView, textPreview } from '../public/view.js'

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

test('long text uses bounded previews without losing any content in the reader', t => {
  const body = install(t)
  for (const text of ['literal <script> text '.repeat(100), 'line\n'.repeat(20)]) {
    const view = jsonTree({ result: { answer: text } })
    assert.ok(view.text.length < text.length + 100)
    const button = view.find(node => node.tag === 'button')[0]
    assert.equal(button.attrs['aria-label'], 'View full text: answer')
    assert.equal(button.attrs['aria-haspopup'], 'dialog')
    button.events.get('click')()
    assert.equal(body.children.at(-1).querySelector('pre').text, text)
  }
  const short = 'First paragraph.\n\nSecond paragraph.'
  assert.equal(textPreview('Output', short).text, short)
  assert.equal(jsonTree({ answer: short }).find(node => node.tag === 'button').length, 0)
})

test('data readers preserve structured values including null replacement values', t => {
  const body = install(t)
  for (const value of [null, { headers: { 'x-fixture': 'value' }, code: 0 }]) {
    openDataDialog('Replacement value', value)
    const dialog = body.children.at(-1)
    assert.ok(dialog.open)
    assert.equal(dialog.querySelector('h2').text, 'Replacement value')
    assert.equal(dialog.find(node => node.attrs.class === 'json-inline').length, 0)
    assert.match(dialog.text, value === null ? /null/ : /headers.*x-fixture.*value.*code.*0/)
  }
})

test('result records keep separate field rows regardless of their text length', t => {
  install(t)
  const records = ['short', 'a_much_longer_prompt_section_identifier', 'last'].map(id => ({
    id,
    scope: 'session',
    characters: 123,
  }))
  const view = jsonTree(records)
  assert.equal(view.find(node => node.attrs.class === 'json-inline').length, 0)
  for (const row of view.children) {
    const fields = row.find(node => node.attrs.class === 'json-rows')[0].children
    assert.deepEqual(
      fields.map(field => field.children[0].text),
      ['id', 'scope', 'characters'],
    )
  }
  const primitiveList = jsonTree({ values: [1, 2, 3] })
  assert.equal(primitiveList.find(node => node.attrs.class === 'json-inline')[0].text, '[1,2,3]')
})

test('prompt sections open full text in named modals from results and dispatch details', t => {
  const body = install(t)
  const text = '<instruction>literal text</instruction>\n' + 'A long section. '.repeat(400)
  const sections = [
    { id: 'core', scope: 'shared', characters: text.length, text },
    { id: 'plugin:empty', scope: 'session', characters: 0, text: '' },
  ]
  for (const view of [jsonTree(sections), payloadView(sections), payloadView({ sections })]) {
    const contents = view.find(node => node.attrs.class === 'prompt-section-content quiet')
    assert.equal(contents.length, 2)
    assert.ok(!view.text.includes(text))
    contents[0].events.get('click')()
    const dialog = body.children.at(-1)
    assert.ok(dialog.open)
    assert.equal(dialog.attrs['aria-labelledby'], dialog.querySelector('h2').id)
    assert.ok(dialog.querySelector('h2').focused)
    assert.equal(dialog.querySelector('pre').text, text)
    dialog.events.get('close')()
    assert.ok(dialog.removed)
    contents[1].events.get('click')()
    assert.equal(body.children.at(-1).querySelector('pre').text, '(Empty section)')
    assert.ok(view.text.includes('plugin:empty'))
    assert.ok(view.text.includes('shared'))
    assert.ok(view.text.includes('session'))
  }
})

test('dialog payloads show all content blocks before optional raw data', t => {
  install(t)
  const content = Array.from({ length: 15 }, (_, index) => ({ type: 'text', text: `Message ${index + 1}\nFull text.` }))
  const view = payloadView({ message: { content }, usage: { input: 30 } })
  const blocks = view.find(node => node.attrs.class === 'detail-text')
  assert.equal(blocks.length, 15)
  assert.ok(blocks[14].text.includes('Message 15'))
  assert.equal(view.children.at(-1).tag, 'details')
  assert.equal(view.children.at(-1).children[0].text, 'Raw data')
  assert.ok(view.children.at(-1).text.includes('input'))
})

test('a structured payload without recognized text is fully expanded', t => {
  install(t)
  const view = payloadView({ entries: Array.from({ length: 15 }, (_, index) => ({ number: index })) })
  assert.equal(view.find(node => node.tag === 'details').length, 0)
  assert.ok(view.text.includes('14'))
})

test('log dialogs are named, focus the heading, and close only for actual backdrop clicks', t => {
  install(t)
  const row = logRow({ at: 0, name: 'fs.read', parts: [['Result', payloadView('Full file contents')]] })
  const dialog = row.querySelector('dialog')
  const heading = dialog.querySelector('h2')
  assert.equal(dialog.attrs['aria-labelledby'], heading.attrs.id)
  assert.ok(dialog.find(node => node.attrs.class === 'detail-body')[0].text.includes('Full file contents'))
  row.open = true
  row.events.get('toggle')()
  assert.ok(dialog.open)
  assert.ok(heading.focused)
  dialog.events.get('click')({ target: dialog, clientX: 150, clientY: 150 })
  assert.ok(dialog.open, 'clicks in blank dialog space keep it open')
  dialog.events.get('click')({ target: dialog, clientX: 50, clientY: 150 })
  assert.equal(dialog.open, false)
})

test('message lists retain role, sequence, tool names and compact empty content', t => {
  install(t)
  const view = payloadView([
    { role: 'assistant', text: '', tools: ['AskUserQuestion'] },
    { role: 'user', text: 'Please continue.', tools: [] },
  ])
  const blocks = view.find(node => node.attrs.class === 'payload-block')
  assert.deepEqual(
    blocks.map(block => block.children[0].text),
    ['Message 1 · Assistant', 'Message 1 · Assistant · Tools', 'Message 2 · User'],
  )
  assert.equal(blocks[0].find(node => node.tag === 'pre').length, 0)
  assert.ok(blocks[0].text.includes('No text content.'))
  assert.ok(blocks[1].text.includes('AskUserQuestion'))
  assert.ok(blocks[2].text.includes('Please continue.'))
})

test('mixed content preserves non-text blocks in order before raw data', t => {
  install(t)
  const view = payloadView({
    content: [
      { type: 'text', text: 'First paragraph.' },
      { type: 'tool_use', name: 'Read', input: { path: 'README.md' } },
      { type: 'text', text: 'Last paragraph.' },
    ],
  })
  const blocks = view.find(node => node.attrs.class === 'payload-block')
  assert.equal(blocks.length, 3)
  assert.ok(blocks[0].text.includes('First paragraph.'))
  assert.ok(blocks[1].children[0].text.includes('Tool call: Read'))
  assert.ok(blocks[1].text.includes('README.md'))
  assert.ok(!blocks[1].text.includes('User'))
  assert.ok(blocks[2].text.includes('Last paragraph.'))
})

test('result wrappers expose output and only known capture truncation gets a note', t => {
  install(t)
  const view = payloadView({ value: { isAnswered: true, text: 'Beginning... (2893 more characters)', usage: {} } })
  assert.ok(view.children[0].text.includes('Beginning... (2893 more characters)'))
  assert.equal(view.find(node => node.attrs.class === 'capture-note muted').length, 1)
  assert.equal(payloadView('A sentence...').find(node => node.attrs.class === 'capture-note muted').length, 0)
  const streams = payloadView({
    chunks: [
      { stream: 'stdout', text: 'one' },
      { stream: 'stderr', text: 'two' },
    ],
  })
  const labels = streams.find(node => node.attrs.class === 'payload-label').map(node => node.text)
  assert.ok(labels[0].includes('stdout'))
  assert.ok(labels[1].includes('stderr'))
})
