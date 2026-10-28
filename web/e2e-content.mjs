// Isolated content-reader regressions; fixtures never start a session or call a model.
/* global document, innerWidth */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const shortText = `First paragraph.\n\nA response containing ${'unbroken'.repeat(45)} and a final sentence.`
const fullText = `${'<literal>Full captured output</literal>\n'.repeat(60)}Last line: nothing omitted.`
const longKey = 'long_property_name_'.repeat(15)
const turnId = 'fixture-turn'
const traces = [
  { seq: 1, at: 1000, event: 'turn.start', input: {}, result: { turnId } },
  {
    seq: 2,
    at: 2000,
    ms: 750,
    event: 'turn.step',
    summary: 'A model response with multiline text, structured records, and lengthy captured output.',
    input: { turnId, index: 0, model: 'fixture-model' },
    result: {
      answer: shortText,
      output: fullText,
      records: [
        { id: 'short', scope: 'session' },
        { id: 'long_identifier_'.repeat(12), scope: 'session' },
      ],
      nested: { [longKey]: { message: shortText, deeper: { message: shortText } } },
    },
  },
  { seq: 3, at: 2200, event: 'turn.complete', input: { reason: 'complete' } },
]
const state = {
  session: null,
  mirror: {},
  traces,
  runs: [
    {
      at: 2000,
      probe: 'process.spawn',
      ok: true,
      args: { argv: 'fixture process' },
      value: {
        code: 0,
        signal: null,
        ms: 20,
        chunks: [
          { ms: 5, stream: 'stdout', text: shortText },
          { ms: 15, stream: 'stderr', text: fullText },
        ],
      },
    },
  ],
}

const directory = await mkdtemp(join(tmpdir(), 'mod-lab-content-'))
let server
let browser
/** @type {import('playwright-core').Page} */
let page

async function renderFixture(surface) {
  await page.evaluate(
    async ({ surface, state }) => {
      const path = surface === 'turns' ? '/turns.js' : '/streams.js'
      const module = await import(path)
      document.body.dataset.area = 'session'
      const ctx = { state, queueRun: () => Promise.reject(new Error('Fixtures must not run probes')) }
      document
        .getElementById('main')
        .replaceChildren(surface === 'turns' ? module.turnsPage(ctx) : module.streamsPage(ctx))
      if (surface === 'streams') module.refreshStreams(state)
    },
    { surface, state },
  )
  if (surface === 'turns') await page.locator('.timeline-event > summary').click()
}

async function checkContainment(label, selector) {
  const failures = await page.locator(selector).evaluateAll(nodes =>
    nodes.flatMap(node => {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return []
      const parent = node.parentElement.getBoundingClientRect()
      const escaped = box.left < parent.left - 1 || box.right > parent.right + 1
      const scrolled = node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1
      return escaped || scrolled ? [{ tag: node.tagName, class: node.className, escaped, scrolled }] : []
    }),
  )
  assert.deepEqual(failures, [], `${label}: rendered content fits its own container`)
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: page fits viewport`,
  )
}

/** @param {import('playwright-core').Locator} button */
async function checkReader(button, expected) {
  await button.click()
  const dialog = page.locator('dialog.text-reader[open]')
  await dialog.waitFor()
  assert.equal(await dialog.locator('pre.text-reader-content').textContent(), expected)
  assert.equal(await dialog.locator('h2').evaluate(node => node === document.activeElement), true)
  await checkContainment('Text reader', 'dialog.text-reader .detail-body, dialog.text-reader pre')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await button.evaluate(node => node === document.activeElement), true, 'Escape restores opener focus')
}

async function checkFixtures() {
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await renderFixture('turns')
      assert.equal(await page.locator('.timeline-event-detail .json-inline').count(), 0)
      assert.equal(await page.locator('.timeline-event-detail pre.json-text').first().textContent(), shortText)
      assert.ok((await page.locator('.timeline-event-detail').textContent()).includes(longKey))
      await checkContainment(
        `Turn timeline ${width}px ${colorScheme}`,
        '.timeline-event-detail, .timeline-event-detail :is(.json-row, .json-rows, .json-nested, .json-key, pre)',
      )
      await checkReader(page.getByRole('button', { name: 'View full text: output', exact: true }), fullText)
      await renderFixture('streams')
      assert.equal(await page.locator('table.pieces pre.text-preview').first().textContent(), shortText)
      assert.equal(await page.locator('.stream-axis .tick').first().getAttribute('title'), '5 ms · stdout')
      await checkContainment(`Streams ${width}px ${colorScheme}`, 'table.pieces, table.pieces td, table.pieces pre')
      await checkReader(page.getByRole('button', { name: 'View full text: stderr · 15 ms', exact: true }), fullText)
    }
  }
}

async function checkGallery() {
  const gallery = await page.evaluate(async () => {
    const path = '/api.js'
    const { api } = await import(path)
    return api('/api/gallery')
  })
  await page.evaluate(async () => {
    const path = '/gallery.js'
    const { galleryPage } = await import(path)
    document.body.dataset.area = 'build'
    document.getElementById('main').replaceChildren(await galleryPage({ state: { session: null } }))
  })
  const first = gallery.tabs.find(tab => tab.excerpts.length > 0 && tab.example !== null)
  assert.ok(first, 'real Gallery has source and a mod snippet')
  const section = page.locator(`#gallery-${first.id}`)
  await checkReader(section.getByRole('button', { name: 'View source', exact: true }).first(), first.excerpts[0].text)
  await checkReader(section.getByRole('button', { name: 'View snippet', exact: true }), first.example.snippet)
}

async function checkSandbox() {
  let saves = 0
  let tests = 0
  const files = { module: '// Fixture module', contract: '// Fixture contract', test: '// Fixture test' }
  await page.route('**/api/sandbox{,/**}', async route => {
    const path = new URL(route.request().url()).pathname
    let response
    if (path === '/api/sandbox')
      response = { lessonWorkspace: '/fixture/lessons', dir: 'sandbox-mod', files, blank: files, examples: [] }
    else if (path === '/api/sandbox/save') {
      assert.equal(route.request().method(), 'POST')
      saves++
      response = {
        validation: {
          ok: saves > 1,
          errors: saves === 1 ? [fullText] : [],
          facts: { hooks: ['turn.start'], calls: [], gating: [], state: [] },
        },
        types: { checked: true, errors: [{ file: 'hooks/register.tsx', line: 7, column: 3, message: fullText }] },
      }
    } else if (path === '/api/sandbox/test') {
      assert.equal(route.request().method(), 'POST')
      tests++
      response = {
        results:
          tests === 1
            ? [
                { status: 'pass', name: 'Simple fixture', detail: ['Short success feedback.'] },
                { status: 'fail', name: 'Failing fixture', detail: [fullText] },
              ]
            : [],
        output: fullText,
      }
    } else throw new Error(`Unexpected Sandbox request: ${path}`)
    await route.fulfill({ json: response })
  })
  await page.evaluate(async () => {
    const path = '/sandbox.js'
    const { sandboxPage } = await import(path)
    document.body.dataset.area = 'build'
    document.getElementById('main').replaceChildren(await sandboxPage())
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('The validator refuses it:', { exact: true }).waitFor()
  assert.equal(await page.getByText('hooks/register.tsx:7:3', { exact: true }).count(), 1)
  await checkReader(page.getByRole('button', { name: 'View full text: Validation error', exact: true }), fullText)
  await checkReader(
    page.getByRole('button', { name: 'View full text: TypeScript error · hooks/register.tsx:7', exact: true }),
    fullText,
  )
  await page.getByRole('button', { name: 'Run tests', exact: true }).click()
  await page.getByText('✓ Simple fixture', { exact: false }).waitFor()
  assert.equal(await page.getByText('Short success feedback.', { exact: true }).count(), 1)
  assert.equal(await page.getByText('✗ Failing fixture', { exact: false }).count(), 1)
  await checkReader(
    page.getByRole('button', { name: 'View full text: Failing fixture · Details', exact: true }),
    fullText,
  )
  await checkContainment('Sandbox reports 320px', '.sandbox .result pre, .sandbox .result .text-preview-block')
  await page.getByRole('button', { name: 'Run tests', exact: true }).click()
  await page.getByText('No test ran.', { exact: true }).waitFor()
  await checkReader(page.getByRole('button', { name: 'View full text: Test output', exact: true }), fullText)
  assert.equal(saves, 3)
  assert.equal(tests, 2)
  await page.unroute('**/api/sandbox{,/**}')
}

async function checkLesson() {
  const lesson = {
    id: 'fixture',
    title: 'Fixture lesson',
    path: 'learn/fixture',
    readme: '# Fixture lesson\n\nLesson instructions remain readable.',
    lessonWorkspace: null,
    check: { report: fullText, progress: { passed: 2, total: 3, at: 1000 } },
  }
  await page.route('**/api/lessons', route => route.fulfill({ json: { lessons: [lesson] } }))
  await page.route('**/api/lesson?*', route => route.fulfill({ json: lesson }))
  await page.evaluate(async () => {
    const path = '/lessons.js'
    const { lessonPage } = await import(path)
    document.body.dataset.area = 'build'
    const ctx = { state: { session: null, mirror: {} } }
    document.getElementById('main').replaceChildren(await lessonPage(ctx, 'fixture'))
  })
  assert.equal(await page.getByText('2 of 3 checked steps pass.', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Lesson instructions remain readable.', { exact: true }).count(), 1)
  await checkContainment('Lesson report 320px', '.lesson .result pre, .lesson .result .text-preview-block')
  await checkReader(page.getByRole('button', { name: 'View full text: Lesson check report', exact: true }), fullText)
  await page.unroute('**/api/lessons')
  await page.unroute('**/api/lesson?*')
}

try {
  server = await startServer({ port: 0, bridgeFile: join(directory, 'bridge.json') })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Keep the real page shell/styles, without its live app replacing injected fixtures.
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.goto(server.url)
  await checkFixtures()
  await checkGallery()
  await checkSandbox()
  await checkLesson()
  assert.deepEqual(errors, [])
  console.log(
    'Content: timeline/stream containment and readers passed in both themes at 1440, 760, 390 and 320px; Gallery, populated Sandbox and Lesson report readers also passed at 320px.',
  )
} finally {
  await browser?.close()
  await server?.close()
  await rm(directory, { recursive: true, force: true })
}
