import assert from 'node:assert/strict'
import { test } from 'node:test'

import { refreshConfig } from '../public/config.js'
import { lessonCatalog, lessonsGuide } from '../public/lesson-catalog.js'

// The elements needed by these read-only views, with traversal for checking
// what remains readable inside disclosures as well as in the initial view.
class Element {
  constructor(tag) {
    this.tag = tag
    this.attrs = {}
    this.children = []
  }
  append(...children) {
    this.children.push(...children)
  }
  replaceChildren(...children) {
    this.children = children
  }
  setAttribute(name, value) {
    this.attrs[name] = value
  }
  addEventListener() {}
  set className(value) {
    this.attrs.class = value
  }
  get text() {
    return this.children.map(child => (child instanceof Element ? child.text : String(child))).join('')
  }
  find(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap(child => (child instanceof Element ? child.find(predicate) : [])),
    ]
  }
}

function install(t, live = null) {
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis))
  const previous = { Node: scope.Node, document: scope.document }
  scope.Node = Element
  scope.document = {
    createElement: tag => new Element(tag),
    createTextNode: text => String(text),
    querySelector: selector => (selector === '[data-live="config"]' ? live : null),
    getElementById: () => null,
  }
  t.after(() => Object.assign(scope, previous))
}

test('settings keep the value separate from expandable choices and describe locks neutrally', t => {
  const live = new Element('div')
  install(t, live)
  refreshConfig({
    mirror: {
      config: [
        {
          key: 'sample.style',
          label: 'Output style',
          provider: 'sample',
          kind: 'text',
          value: 'long-form',
          options: ['long-form', 'brief', 'structured'],
          description: 'Choose how the answer is presented.',
          isLocked: true,
        },
      ],
    },
  })
  const kind = live.find(node => node.attrs['data-label'] === 'Kind')[0]
  const choices = kind.find(node => node.tag === 'details')[0]
  assert.equal(kind.children[0], 'text')
  assert.equal(choices.attrs.open, undefined)
  assert.ok(choices.text.includes('long-form'))
  assert.ok(choices.text.includes('structured'))
  const value = live.find(node => node.attrs['data-label'] === 'Value')[0]
  assert.ok(value.text.includes('"long-form"'))
  const lock = value.find(node => node.attrs.class === 'config-lock muted')[0]
  assert.equal(lock.text, 'locked')
  assert.equal(live.find(node => node.attrs.class === 'rewritten').length, 0)
  assert.ok(live.find(node => node.tag === 'details').some(node => node.text.includes('Choose how the answer')))
})

test('the lesson catalog preserves summaries and progress without repeating incompatible lessons in its guide', t => {
  install(t)
  const lesson = {
    id: 'tick',
    kind: 'tutorial',
    path: 'learn/tutorials/tick',
    title: 'A stopwatch you can click',
    summary: 'Make its button count, then start a timer.',
    minVersion: '2.1.299',
    progress: { passed: 2, total: 4 },
  }
  const catalog = lessonCatalog(
    [lesson, { ...lesson, id: 'future', title: 'Future lesson', minVersion: '9.0.0' }],
    '2.1.303',
  )
  assert.ok(catalog.text.includes(lesson.summary))
  assert.ok(catalog.text.includes('2 of 4 checked steps pass'))
  assert.ok(!catalog.text.includes('Future lesson'))
  const guide = lessonsGuide(
    '# Lessons\n\nGuide introduction.\n\n| Lesson | Kind | What it builds |\n| --- | --- | --- |\n| [tick](tutorials/tick) | tutorial | Old duplicate summary |\n| [future](tutorials/future) | tutorial | Future lesson |\n\n## Each lesson\n\n| Part | Meaning |\n| --- | --- |\n| README.md | Instructions |\n',
  )
  assert.ok(!guide.includes('Old duplicate summary'))
  assert.ok(!guide.includes('Future lesson'))
  assert.ok(guide.includes('Guide introduction'))
  assert.ok(guide.includes('| README.md | Instructions |'))
})
