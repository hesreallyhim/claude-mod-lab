// Run with node web/e2e-lesson-progress.mjs. Real lesson IDs/titles and DOM; no session or model calls.
/* global document */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { loadLessons } from '../learn/lib/lessons.mjs'

const SESSION_VERSION = '2.1.303'
// Keep catalog lessons eligible in this fixture; the explicit future lesson below tests version gating.
const lessons = loadLessons(fileURLToPath(new URL('../learn', import.meta.url))).map(lesson => ({
  id: lesson.id,
  title: lesson.title,
  minVersion: SESSION_VERSION,
  progress: lesson.id === 'tick' ? { passed: 4, total: 4 } : null,
}))

/** @param {import('playwright-core').Page} page */
async function render(page, lessons, version = SESSION_VERSION) {
  await page.evaluate(
    async ({ lessons, version }) => {
      const module = '/lesson-catalog.js'
      const { lessonProgress } = await import(module)
      const main = document.createElement('main')
      main.className = 'page'
      const heading = document.createElement('h1')
      heading.textContent = 'Lessons'
      main.append(heading)
      const progress = lessonProgress(lessons, version)
      if (progress !== null) main.append(progress)
      document.body.replaceChildren(main)
    },
    { lessons, version },
  )
}

/** @param {import('playwright-core').Page} page */
async function fits(page) {
  const width = page.viewportSize().width
  for (const box of await page.locator('.lesson-completion, .completion-lessons a').all()) {
    const bounds = await box.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'summary and lesson links fit the viewport')
  }
  assert.ok(await page.locator('.lesson-completion').evaluate(node => node.scrollWidth <= node.clientWidth))
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://progress.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pages.css"><link rel="stylesheet" href="/lesson-progress.css"></head><body data-area="build"></body></html>',
      })
    const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'font/woff2'
    return route.fulfill({ contentType, body: await readFile(new URL(`./public${path}`, import.meta.url)) })
  })
  await page.goto('http://progress.test/')
  const withStates = lessons.map((lesson, index) => ({
    ...lesson,
    progress: index === 1 ? { passed: 1, total: 4 } : index === 2 ? { passed: 0, total: 3 } : lesson.progress,
  }))
  const gated = [
    ...withStates,
    { id: 'future', title: 'Future lesson', minVersion: '9.0.0', progress: { passed: 1, total: 1 } },
  ]
  await render(page, gated)
  const progress = page.getByRole('region', { name: 'Your progress' })
  assert.equal(await progress.count(), 1)
  assert.match(await progress.innerText(), new RegExp(`1 of ${lessons.length} lessons complete`))
  assert.equal(await page.getByRole('progressbar', { name: 'Completed lessons' }).getAttribute('value'), '1')
  assert.equal(await page.locator('.completion-lessons a[data-state="in progress"]').count(), 2)
  assert.equal(await page.getByRole('link', { name: 'Future lesson: complete' }).count(), 0)
  const tick = page.getByRole('link', { name: 'A stopwatch you can click: complete', exact: true })
  assert.match(await tick.innerText(), /✓/)
  assert.equal(await tick.getAttribute('href'), '#/learn/tick')
  await tick.click()
  assert.ok(page.url().endsWith('#/learn/tick'))

  await render(page, gated, null)
  assert.equal(await page.getByRole('link', { name: 'Future lesson: complete' }).count(), 1)
  await render(page, [{ id: 'empty', title: 'No checks', progress: { passed: 0, total: 0 } }])
  assert.equal(await page.getByRole('link', { name: 'No checks: in progress' }).count(), 1)
  assert.equal(await page.getByRole('progressbar').getAttribute('value'), '0')
  await render(page, [])
  assert.equal(await page.getByRole('region', { name: 'Your progress' }).count(), 0)

  await render(page, lessons)
  assert.equal(await page.locator('.completion-lessons a[data-state="not started"]').count(), lessons.length - 1)
  await fits(page)
  await page.screenshot({ path: '/tmp/mod-lab-lesson-progress-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await fits(page)
  await page.screenshot({ path: '/tmp/mod-lab-lesson-progress-mobile.png' })
  assert.deepEqual(errors, [])
  console.log(
    'Lesson progress reflects saved completion, partial/zero checks, version filtering, and links; desktop/mobile layouts fit.',
  )
} finally {
  await browser.close()
}
