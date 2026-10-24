// Run with node web/e2e-intercepts.mjs. Real explorer UI, mocked session events; no Claude session or model calls.
/* global window, document */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const catalog = {
  path: '/test/mod-api.d.ts',
  version: '2.1.303',
  typeNames: [],
  types: [],
  nouns: [
    {
      name: 'fs',
      members: [
        {
          name: 'exists',
          kind: 'method',
          event: 'fs.exists',
          eventKind: 'op',
          signature: '(path: string) => boolean',
          params: [],
          examples: [],
        },
      ],
    },
  ],
  events: [{ name: 'fs.exists', namespace: 'fs', input: '{ path: string }', result: 'boolean', examples: [] }],
}
const session = {
  client: 'test-session',
  isConnected: true,
  facts: { id: 'test-session', cwd: '/test', version: '2.1.303' },
  probes: [],
  interceptable: ['fs.exists'],
}
const first = { event: 'fs.exists', behavior: 'refuse', scope: 'lab', value: null, since: 1, until: null }
const second = {
  event: 'ui.toast',
  behavior: 'rewrite',
  scope: 'all',
  value: { text: 'Intercepted' },
  since: 1,
  until: null,
}
const snapshot = intercepts => ({ session, runs: [], traces: [], taps: [], jobs: [], mirror: { intercepts } })

/** @param {import('playwright-core').Page} page */
async function emit(page, name, data) {
  await page.evaluate(
    ({ name, data }) => {
      const scope = /** @type {any} */ (window)
      scope.sessionEvents.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }))
    },
    { name, data },
  )
}

/** @param {import('playwright-core').Page} page */
async function checkCount(page, expected) {
  await page.waitForFunction(expected => document.getElementById('intercept-count').textContent === expected, expected)
}

/** @param {import('playwright-core').Page} page */
async function checkPanelFits(page) {
  const panel = await page.locator('#intercept-panel').boundingBox()
  const rail = await page.locator('#intercept-status > summary').boundingBox()
  const viewport = page.viewportSize()
  assert.ok(panel && rail)
  assert.ok(panel.x >= 0 && panel.x + panel.width <= viewport.width, 'disclosure fits horizontally')
  assert.ok(panel.y >= 0 && panel.y + panel.height <= viewport.height, 'disclosure fits vertically')
  assert.ok(rail.x >= 0 && rail.x + rail.width <= viewport.width, 'count remains visible in the rail')
}

/** @param {import('playwright-core').Page} page */
async function checkSessionTooltip(page) {
  const tip = page.getByRole('tooltip')
  await tip.waitFor()
  assert.equal(await tip.locator('.tip-heading').textContent(), 'Session details')
  const facts = await tip
    .locator('.tip-fact')
    .evaluateAll(rows =>
      Object.fromEntries(
        rows.map(row => [row.querySelector('.tip-label').textContent, row.querySelector('.tip-value').textContent]),
      ),
    )
  assert.deepEqual(facts, {
    Workspace: '/test',
    'Session ID': 'test-session',
    Runtime: 'Claude Code 2.1.302',
    'API reference': 'Claude Code 2.1.303',
    'Reference file': '/test/mod-api.d.ts',
  })
  const bounds = await tip.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, 'session tooltip fits horizontally')
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'session tooltip fits vertically')
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  const commands = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const scope = /** @type {any} */ (window)
    scope.EventSource = class extends EventTarget {
      constructor() {
        super()
        scope.sessionEvents = this
      }
    }
  })
  await page.route('http://intercepts.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/catalog') return route.fulfill({ json: catalog })
    if (path === '/api/command') {
      commands.push(route.request().postDataJSON())
      return route.fulfill({ json: { job: `command-${commands.length}` } })
    }
    if (path.startsWith('/api/')) return route.fulfill({ json: {} })
    const file = path === '/' ? '/index.html' : path
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.woff2')
          ? 'font/woff2'
          : 'text/html'
    return route.fulfill({ contentType: type, body: await readFile(new URL(`./public${file}`, import.meta.url)) })
  })
  await page.goto('http://intercepts.test/#/$/fs.exists')
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).sessionEvents))
  await emit(page, 'snapshot', snapshot([]))
  await page.locator('form.intercept').waitFor()
  assert.equal(await page.locator('#intercept-status').isVisible(), false)
  assert.equal(await page.locator('.bench .idle, .bench .cursor').count(), 0)
  await emit(page, 'mirror', { key: 'intercepts', value: [first] })
  await checkCount(page, '1 intercept active')
  assert.equal(await page.locator('#intercept-status').isVisible(), true)
  await page.locator('#intercept-status > summary').click()
  assert.match(await page.locator('#intercept-panel').innerText(), /fs.exists/)
  assert.match(await page.locator('#intercept-panel').innerText(), /Refuses the lab's own calls/)
  await emit(page, 'mirror', { key: 'intercepts', value: [first, second] })
  await checkCount(page, '2 intercepts active')
  assert.equal(await page.locator('#intercept-status').getAttribute('open'), '')
  assert.equal(await page.locator('#intercept-panel .force').count(), 2)
  await checkPanelFits(page)
  await page.screenshot({ path: '/tmp/mod-lab-intercepts-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await checkPanelFits(page)
  await page.screenshot({ path: '/tmp/mod-lab-intercepts-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })

  const response = page.waitForResponse('http://intercepts.test/api/command')
  await page.locator('#intercept-panel .force').first().getByRole('button', { name: 'Clear', exact: true }).click()
  await response
  assert.deepEqual(commands, [{ text: 'intercept clear fs.exists' }])
  await checkCount(page, '2 intercepts active')
  await emit(page, 'mirror', { key: 'intercepts', value: [second] })
  await checkCount(page, '1 intercept active')
  assert.equal(await page.locator('#intercept-panel .force').count(), 1)
  assert.match(await page.locator('#intercept-panel').innerText(), /ui.toast/)

  for (const hash of ['#/event/fs.exists', '#/turns', '#/probes', '#/']) {
    await page.evaluate(hash => {
      window.location.hash = hash
    }, hash)
    await page.waitForFunction(hash => window.location.hash === hash, hash)
    await checkCount(page, '1 intercept active')
    assert.equal(await page.locator('#intercept-status').isVisible(), true)
    if (hash === '#/event/fs.exists') {
      await page.getByRole('heading', { name: 'fs.exists', exact: true }).waitFor()
      assert.equal(await page.locator('.bench .idle, .bench .cursor').count(), 0)
    }
  }
  await emit(page, 'session', { ...session, isConnected: false })
  await checkCount(page, '1 intercept · last known')
  assert.match(await page.locator('#intercept-panel').innerText(), /reconnect to verify or clear/)
  await page.setViewportSize({ width: 390, height: 844 })
  await checkPanelFits(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await emit(page, 'session', session)
  await checkCount(page, '1 intercept active')
  await emit(page, 'mirror', { key: 'intercepts', value: [] })
  await page.locator('#intercept-status').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#intercept-status').getAttribute('open'), null)

  await page.reload()
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).sessionEvents))
  await emit(page, 'snapshot', snapshot([first, second]))
  await checkCount(page, '2 intercepts active')
  assert.equal(await page.locator('#intercept-status').isVisible(), true)
  const olderSession = { ...session, facts: { ...session.facts, version: '2.1.302' } }
  await emit(page, 'session', olderSession)
  await page.locator('#session').hover()
  await checkSessionTooltip(page)
  await page.screenshot({ path: '/tmp/mod-lab-session-desktop.png' })
  await page.mouse.move(0, 900)
  await page.locator('#intercept-status > summary').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('#session').evaluate(node => node === document.activeElement), true)
  await checkSessionTooltip(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await checkSessionTooltip(page)
  await page.screenshot({ path: '/tmp/mod-lab-session-mobile.png' })
  await emit(page, 'error', null)
  await checkCount(page, '2 intercepts · last known')
  assert.equal(await page.locator('#session-text').textContent(), 'the explorer server is not answering')
  assert.equal(await page.locator('#session-tip .tip-heading').textContent(), 'Session details')
  assert.equal(await page.locator('#session-where').count(), 1)
  await emit(page, 'snapshot', { ...snapshot([first, second]), session: olderSession })
  await checkCount(page, '2 intercepts active')
  assert.equal(await page.locator('#session-text').textContent(), 'session connected')
  await page.locator('#session').hover()
  await checkSessionTooltip(page)
  const tap = {
    event: 'fs.exists',
    behavior: 'refuse',
    origin: 'mod-lab',
    at: 2,
    chain: [],
    received: {},
    returned: null,
  }
  await emit(page, 'snapshot', {
    ...snapshot([first, second]),
    taps: Array.from({ length: 500 }, (_, index) => ({ ...tap, seq: index + 1 })),
  })
  assert.equal(await page.locator('#intercept-panel .tally').first().textContent(), '500 calls')
  await emit(page, 'taps', [{ ...tap, event: 'ui.toast', seq: 501 }])
  assert.deepEqual(await page.locator('#intercept-panel .tally').allTextContents(), ['499 calls', '1 call'])
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  console.log(
    'Top-rail intercepts track snapshots, live changes, navigation, clearing, and disconnection; desktop/mobile disclosures and session tooltips fit; tooltip labels survive connection errors; decorative prompts are absent.',
  )
} finally {
  await browser.close()
}
