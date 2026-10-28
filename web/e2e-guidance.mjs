// Guidance regressions against a real, isolated explorer without starting a Claude session.
/* global document, innerWidth, innerHeight */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'mod-lab-guidance-'))
let server
let browser
/** @type {import('playwright-core').Page} */
let page
const errors = []
const pages = [
  ['turns', 'Turn timeline', 'How it works'],
  ['streams', 'Streams', 'How it works'],
  ['agents', 'Agents', 'How it works'],
  ['config', 'Settings', 'How it works'],
  ['workbench', 'Model workbench', 'How it works'],
  ['xray', 'Conversation X-ray', 'How it works'],
  ['keys', 'Prompt box', 'How the box works'],
  ['learn', 'Lessons', 'How lessons work'],
  ['ledger', 'Context ledger', 'How it works'],
  ['mods', 'Installed mods', 'How it works'],
]

async function layoutHeights() {
  return page.locator('#main, #feed').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
}

/** @param {import('playwright-core').Locator} button */
async function checkDialog(button, label, visualLegend = false) {
  await button.scrollIntoViewIfNeeded()
  const before = await layoutHeights()
  assert.equal(await button.getAttribute('aria-haspopup'), 'dialog')
  let expected
  for (let attempt = 0; attempt < 2; attempt++) {
    await button.click()
    const dialog = page.getByRole('dialog', { name: label, exact: true })
    await dialog.waitFor()
    const content = await dialog.locator('.detail-body').innerText()
    assert.ok(content.trim().length > 40, `${label}: full guidance is present`)
    if (attempt === 0) expected = content
    else assert.equal(content, expected, `${label}: reopening preserves all content`)
    assert.equal(await dialog.locator('.detail-title').evaluate(node => node === document.activeElement), true)
    assert.ok(
      await dialog.evaluate(node => {
        const box = node.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
      }),
      `${label}: dialog fits viewport`,
    )
    assert.ok(
      await dialog.locator('.detail-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1),
      `${label}: guidance stays within the reader`,
    )
    if (visualLegend) {
      assert.equal(await dialog.locator('.feed-legend dt').count(), 5)
      assert.ok((await dialog.locator('.feed-legend .mark, .feed-legend .strip').count()) >= 5)
    }
    assert.deepEqual(await layoutHeights(), before, `${label}: opening help does not shift page content`)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await button.evaluate(node => node === document.activeElement), true, `${label}: focus returns`)
    assert.deepEqual(await layoutHeights(), before, `${label}: closing help preserves page layout`)
  }
}

async function checkActions(route) {
  const groups = {
    agents: [
      ['Register an agent type', page.locator('#agents-register')],
      ['Hide types and route spawns', page.locator('#agents-routing')],
    ],
    xray: [['Add a note or notice', page.locator('#main details:has(form[data-command="notice"])')]],
    workbench: [
      [
        'Fork the conversation',
        page
          .locator('#main details')
          .filter({ has: page.getByRole('button', { name: 'Fork', exact: true, includeHidden: true }) }),
      ],
    ],
  }[route]
  for (const [title, group] of groups ?? []) {
    assert.equal(await group.count(), 1, `${title}: action group remains in the page`)
    assert.equal(await group.locator(':scope > summary').count(), 1, `${title}: action group remains toggleable`)
    assert.ok((await group.locator('form').count()) > 0, `${title}: working controls remain available`)
  }
}

async function checkPage(route, title, helpTitle) {
  await page.goto(`${server.url}/#/${route}`)
  await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor()
  const help = page.locator('#main .page-head').getByRole('button', { name: helpTitle, exact: true })
  await help.waitFor()
  await checkActions(route)
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await checkDialog(help, helpTitle)
      if (route === 'xray')
        await checkDialog(
          page.locator('.compactor .readings-head').getByRole('button', { name: 'How compaction works' }),
          'How compaction works',
        )
      if (route === 'turns') {
        assert.ok(
          await page.locator('#feed-help').evaluate(node => {
            const body = document.getElementById('feed-body')
            return node.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 1
          }),
          'Feed guidance appears before the rows',
        )
        await checkDialog(page.getByRole('button', { name: 'How to read a row' }), 'How to read a row', true)
      }
    }
  }
}

try {
  server = await startServer({ port: 0, bridgeFile: join(directory, 'bridge.json') })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  for (const [route, title, helpTitle] of pages) await checkPage(route, title, helpTitle)
  for (const route of ['workshop', 'sandbox']) {
    await page.goto(`${server.url}/#/${route}`)
    await page.getByRole('heading', { name: route === 'workshop' ? 'Workshop' : 'Sandbox', level: 1 }).waitFor()
    await page.getByText('npx claude-mod-lab init-lessons ~/mod-lessons', { exact: false }).waitFor()
    assert.equal(await page.locator('#main .page-head .help-button').count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Guidance: 72 responsive/theme checks passed, including header placement, repeat opening, focus, stable layout, visual legend and preserved action groups.',
  )
} finally {
  await browser?.close()
  await server?.close()
  await rm(directory, { recursive: true, force: true })
}
