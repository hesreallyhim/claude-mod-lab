// The live regions a page redraws in place, drawn with populated state on a
// small stand-in for the DOM: enough of document and Node for view.js's el and
// fill. An array handed to replaceChildren draws as "[object ...]" text, which
// is what these checks look for.

import assert from 'node:assert/strict'
import { test } from 'node:test'

class FakeText {
  constructor(text) {
    this.text = text
  }
}

class FakeNode {
  constructor(tag) {
    this.tagName = tag
    this.childNodes = []
    this.attrs = {}
  }
  append(...children) {
    for (const child of children)
      this.childNodes.push(child instanceof FakeNode || child instanceof FakeText ? child : new FakeText(String(child)))
  }
  replaceChildren(...children) {
    this.childNodes = []
    this.append(...children)
  }
  setAttribute(key, value) {
    this.attrs[key] = value
  }
  addEventListener() {}
  get className() {
    return this.attrs.class ?? ''
  }
  set className(value) {
    this.attrs.class = value
  }
  set textContent(value) {
    this.replaceChildren(value)
  }
  get textContent() {
    return this.text
  }
  querySelector() {
    return null
  }
  get text() {
    return this.childNodes.map(child => child.text).join('')
  }
}

/** A document whose querySelector answers `found` for a page's live region and nothing for the rest. */
function install(found) {
  // The stand-ins are typed loosely: they are the few members view.js and the pages touch, not the DOM.
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis))
  scope.Node = FakeNode
  scope.document = {
    createElement: tag => new FakeNode(tag),
    createTextNode: text => new FakeText(text),
    querySelector: selector => (selector.startsWith('[data-live=') ? found : null),
    querySelectorAll: () => [],
    getElementById: () => null,
  }
  scope.window = { addEventListener() {}, location: { hash: '#/' } }
  scope.location = { hash: '#/' }
}

const { refreshWorkbench } = await import('../public/workbench.js')
const { refreshAgents } = await import('../public/agents.js')

test('the workbench draws its calls table, legend and all, once a call was made', () => {
  const live = new FakeNode('div')
  install(live)
  const call = {
    seq: 1,
    plugin: 'mod-lab',
    event: 'model.complete',
    model: 'haiku',
    isSent: true,
    at: Date.now(),
    ms: 420,
    usage: { input: 32, output: 167, cacheRead: 62_322, cacheWrite: 0 },
  }
  refreshWorkbench({
    mirror: {
      spend: {
        calls: [call],
        totals: { 'mod-lab': { calls: 1, sent: 1, input: 32, output: 167, cacheRead: 62_322, cacheWrite: 0 } },
      },
      intercepts: [],
    },
  })
  const text = live.text
  assert.ok(!text.includes('[object'), `an array reached the DOM as text: ${text}`)
  assert.ok(text.includes('model calls 1 (1 sent)'), text)
  assert.ok(
    live.childNodes.some(node => node.tagName === 'table'),
    'the calls table is drawn',
  )
  // The ticking clock the refresh starts is stopped by a refresh that finds no region.
  install(null)
  refreshWorkbench({ mirror: { spend: { calls: [], totals: {} }, intercepts: [] } })
})

test('the agents page draws a card for each spawn', () => {
  const live = new FakeNode('div')
  install(live)
  const run = {
    agentId: 'a1',
    type: 'Explore',
    by: 'mod-lab',
    model: 'haiku',
    isRouted: false,
    status: 'done',
    durationMs: 1200,
    prompt: 'list the files',
    answer: 'three files',
  }
  refreshAgents(
    { mirror: { agents: { types: [], runs: [run, { ...run, agentId: 'a2' }], hidden: [], route: null } } },
    () => {},
  )
  const text = live.text
  assert.ok(!text.includes('[object'), `an array reached the DOM as text: ${text}`)
  assert.equal(live.childNodes.filter(node => node.tagName === 'article').length, 2, 'one card a spawn')
})
