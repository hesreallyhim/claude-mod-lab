// Run with node web/e2e-home.mjs. Uses installed Chrome; no session or model calls.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const requests = []
  await page.route('http://home.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/run') {
      requests.push(route.request().postDataJSON())
      await route.fulfill({ json: { job: `test-${requests.length}` } })
    } else if (path === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' })
    } else if (/^\/[a-z-]+\.js$/.test(path)) {
      await route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(new URL(`./public${path}`, import.meta.url), 'utf8'),
      })
    } else await route.abort()
  })
  await page.goto('http://home.test/')
  await page.evaluate(async () => {
    const homeModule = '/home.js'
    const runsModule = '/runs.js'
    const { homePage } = await import(homeModule)
    const { queueRun } = await import(runsModule)
    const state = {
      session: {
        isConnected: true,
        facts: { id: 'test-session', cwd: '/test' },
        probes: [{ id: 'ui.toast', params: [{ name: 'text' }] }, { id: 'prompt.fill' }],
      },
      mirror: { intercepts: [] },
      taps: [],
      jobs: new Map(),
    }
    // eslint-disable-next-line no-undef -- This callback runs in the browser.
    document.body.append(homePage({ state, queueRun: (probe, args, target) => queueRun(state, probe, args, target) }))
  })
  for (const label of ['Send toast', 'Fill prompt box', 'Edit prompt box']) {
    const response = page.waitForResponse('http://home.test/api/run')
    await page.getByRole('button', { name: label, exact: true }).click()
    await response
  }
  assert.deepEqual(requests, [
    { probe: 'ui.toast', args: { text: 'Hello from the mod-lab!' } },
    { probe: 'prompt.fill', args: { text: 'A mod wrote this.', mode: 'append' } },
    { probe: 'prompt.fill', args: { text: 'A mod EDITED this.', mode: 'replace' } },
  ])
  console.log('Home-page toast, write, and edit actions send the expected probe arguments.')
} finally {
  await browser.close()
}
