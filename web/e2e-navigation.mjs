// Browser regression checks for the explorer's persistent navigation and connection help.
// Runs against an isolated, disconnected explorer; no Claude session is started.
/* global document, innerWidth */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'mod-lab-navigation-'))
const server = await startServer({ port: 0, bridgeFile: join(directory, 'bridge.json') })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))

async function checkHelp() {
  const help = page.getByRole('button', { name: 'Help', exact: true })
  await help.click()
  const dialog = page.getByRole('dialog', { name: 'Connection help' })
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /npx claude-mod-lab run/)
  assert.match(await dialog.innerText(), /\/mod-lab explorer/)
  assert.doesNotMatch(await dialog.innerText(), /init-lessons/)
  assert.equal(await page.locator('#connection-help-title').evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await help.evaluate(el => el === document.activeElement), true)
  await help.click()
  await page.getByRole('button', { name: 'Close help' }).click()
  await dialog.waitFor({ state: 'detached' })
  await help.click()
  await page.mouse.click(2, 2)
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.id === 'connection-help')
}

async function checkMenus() {
  const session = page.getByLabel('Session sections', { exact: true })
  await session.focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.area-dropdown[open]').count(), 1, 'Enter opens the focused section dropdown')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.area-dropdown[open]').count(), 0)
  assert.equal(
    await session.evaluate(el => el === document.activeElement),
    true,
    await page.evaluate(() => document.activeElement.outerHTML.slice(0, 200)),
  )
  await session.click()
  await page.getByLabel('Build sections', { exact: true }).click()
  assert.equal(await page.locator('.area-dropdown[open]').count(), 1)
  await page.mouse.click(1400, 800)
  assert.equal(await page.locator('.area-dropdown[open]').count(), 0)
  await session.click()
  await page.locator('.area-menu').getByRole('link', { name: 'Context ledger', exact: true }).click()
  await page.waitForURL('**/#/ledger')
  await page.getByRole('heading', { name: 'Context ledger', exact: true }).waitFor()
  await page.locator('.area-link', { hasText: 'Build' }).click()
  await page.waitForURL('**/#/learn')
  await page.locator('.area-link', { hasText: 'Session' }).click()
  await page.waitForURL('**/#/ledger')
}

async function checkLayout() {
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 1101, 1000, 760, 601, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (const area of ['Mod API', 'Session', 'Build']) {
        await page.getByLabel(`${area} sections`, { exact: true }).click()
        const inside = await page.locator('.area-dropdown[open] .area-menu').evaluate(el => {
          const box = el.getBoundingClientRect()
          return box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth
        })
        assert.ok(inside, `${area} menu fits at ${width}px in ${colorScheme}`)
        await page.keyboard.press('Escape')
      }
      await checkHelp()
    }
  }
}

try {
  await page.goto(server.url)
  await page.getByText('no session connected', { exact: true }).waitFor()
  await checkHelp()
  await checkMenus()
  await checkLayout()
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const route of ['api', 'ledger', 'learn']) {
    await page.goto(`${server.url}/#/${route}`)
    await page.waitForFunction(
      area => document.body.dataset.area === area,
      { api: 'api', ledger: 'session', learn: 'build' }[route],
    )
    assert.equal(
      await page.evaluate(() => {
        const brand = document.querySelector('.brand').getBoundingClientRect()
        const nav = document.querySelector('#nav').getBoundingClientRect()
        return brand.right === nav.right
      }),
      true,
      `brand aligns with sidebar on ${route}`,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Navigation: dropdowns, remembered routes, disconnected help, keyboard/focus, alignment and 48 responsive/theme checks passed.',
  )
} finally {
  await browser.close()
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
