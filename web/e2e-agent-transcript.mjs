// Isolated transcript fixtures; no session, model, or project files are touched.
/* global document, innerWidth */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const agentId = 'fixture-agent'
const fullText = '<literal>Complete tool output</literal>\n'.repeat(60) + 'Final output line.'
const messages = [
  { role: 'user', text: 'Count markdown files.' },
  { role: 'assistant', text: '' },
  {
    role: 'assistant',
    toolUses: [
      {
        tool_use_id: 'call-1',
        tool: 'Bash',
        input: { command: 'find docs -name "*.md"', description: 'Count files' },
        text: 'duplicate attached output',
      },
    ],
  },
  { role: 'user', toolResults: [{ tool_use_id: 'call-1', text: '12' }] },
  {
    role: 'assistant',
    toolUses: [
      { tool_use_id: 'call-2', tool: 'Bash', input: { command: 'find docs -name "*.md" -print' }, text: fullText },
    ],
  },
  { role: 'assistant', text: 'There are 12 files.' },
]
const envelope = (rows, extra = {}) =>
  JSON.stringify({ kind: 'agent-transcript', version: 1, agentId, messages: rows, ...extra })
const directory = await mkdtemp(join(tmpdir(), 'mod-lab-agent-transcript-'))
let server
let browser
/** @type {import('playwright-core').Page} */
let page
let jobSequence = 0
let latestJob
let failRequest = false

async function renderFixture(answer = null) {
  latestJob = `fixture-job-${++jobSequence}`
  await page.evaluate(
    async ({ agentId, answer, jobId }) => {
      const agentsPath = '/agents.js'
      const runsPath = '/runs.js'
      const { agentsPage } = await import(agentsPath)
      const { sendCommand, updateJob } = await import(runsPath)
      const jobs = new Map()
      if (answer !== null) jobs.set(jobId, { id: jobId, kind: 'command', status: 'done', answer })
      const state = {
        session: { isConnected: true },
        jobs,
        mirror: {
          agents: {
            types: [],
            hidden: [],
            route: null,
            runs: [
              {
                agentId,
                type: 'general-purpose',
                by: 'engine',
                status: 'done',
                durationMs: 1200,
                model: 'fixture-model',
                prompt: 'Count markdown files.',
                answer: '12',
              },
            ],
          },
        },
      }
      const fixture = { state, updateJob, ready: Promise.resolve() }
      globalThis['agentFixture'] = fixture
      document.body.dataset.area = 'session'
      document
        .getElementById('main')
        .replaceChildren(agentsPage({ state, sendCommand: (...args) => (fixture.ready = sendCommand(state, ...args)) }))
    },
    { agentId, answer, jobId: latestJob },
  )
}

async function finishJob(answer, status = 'done') {
  await page.evaluate(
    async ({ answer, status, jobId }) => {
      const fixture = globalThis['agentFixture']
      await fixture.ready
      fixture.updateJob(fixture.state, { id: jobId, kind: 'command', status, answer, error: answer })
    },
    { answer, status, jobId: latestJob },
  )
}

async function containment(label) {
  const failures = await page
    .locator(
      'dialog[open] :is(.detail-body, .agent-transcript, section, .json-row, .json-rows, .json-nested, pre, .text-preview-block)',
    )
    .evaluateAll(nodes =>
      nodes.flatMap(node => {
        const box = node.getBoundingClientRect()
        if (!box.width || !box.height) return []
        const parent = node.parentElement.getBoundingClientRect()
        return box.left < parent.left - 1 || box.right > parent.right + 1 || node.scrollWidth > node.clientWidth + 1
          ? [{ tag: node.tagName, class: node.className }]
          : []
      }),
    )
  assert.deepEqual(failures, [], label)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label)
}

async function openTranscript() {
  const agentsPanel = page
    .locator('.agent-panel')
    .filter({ has: page.getByRole('heading', { name: 'Agents this session', exact: true }) })
  if (!(await agentsPanel.evaluate(node => node.hasAttribute('open')))) await agentsPanel.locator('summary').click()
  const opener = page.getByRole('button', { name: 'View transcript', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: `general-purpose · ${agentId} transcript`, exact: true })
  await dialog.waitFor()
  assert.equal(await dialog.locator('h2').evaluate(node => node === document.activeElement), true)
  return { opener, dialog }
}

async function closeTranscript(opener, dialog) {
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await opener.evaluate(node => node === document.activeElement), true)
}

async function checkStructuredFixtures() {
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await renderFixture()
      const panels = page.locator('.agent-panel')
      assert.deepEqual(await panels.evaluateAll(nodes => nodes.map(node => node.hasAttribute('open'))), [
        true,
        false,
        false,
        false,
      ])
      const spawnPrompt = panels.first().locator('input[name="prompt"]')
      await spawnPrompt.fill('Keep this draft when collapsed')
      const spawnHeading = panels.first().locator('summary')
      await spawnHeading.focus()
      await page.keyboard.press('Enter')
      assert.equal(await spawnPrompt.isVisible(), false)
      await page.keyboard.press('Space')
      assert.equal(await spawnPrompt.inputValue(), 'Keep this draft when collapsed')
      assert.equal(await spawnPrompt.isVisible(), true)
      if (colorScheme === 'dark' && [1440, 390].includes(width))
        await page.screenshot({ path: `/tmp/mod-lab-agent-panels-${width}.png` })
      const { opener, dialog } = await openTranscript()
      assert.deepEqual(await panels.evaluateAll(nodes => nodes.map(node => node.hasAttribute('open'))), [
        true,
        true,
        false,
        false,
      ])
      assert.equal(await dialog.getByText('queued for the session', { exact: true }).count(), 1)
      await finishJob('', 'sent')
      assert.equal(await dialog.getByText('running in the session', { exact: true }).count(), 1)
      await finishJob(envelope(messages))
      assert.deepEqual(await dialog.locator('h3').allTextContents(), [
        'User',
        'Tool call · Bash',
        'Tool result · Bash',
        'Tool call · Bash',
        'Tool result · Bash',
        'Assistant',
      ])
      assert.equal(await dialog.getByText('find docs -name "*.md"', { exact: true }).count(), 1)
      assert.equal(await dialog.locator('.transcript-result').count(), 2)
      assert.equal(await dialog.locator('.transcript-result').first().locator('pre').textContent(), '12')
      assert.ok(!(await dialog.textContent()).includes('duplicate attached output'))
      assert.ok((await dialog.textContent()).includes('1 message contained no available text or tool data'))
      await containment(`${colorScheme} ${width}px transcript`)
      if (colorScheme === 'dark' && [1440, 390].includes(width))
        await page.screenshot({ path: `/tmp/mod-lab-agent-transcript-${width === 1440 ? 'desktop' : 'mobile'}.png` })
      const full = dialog.getByRole('button', { name: 'View full text: Bash result', exact: true })
      await full.click()
      const reader = page.getByRole('dialog', { name: 'Bash result', exact: true })
      await reader.waitFor()
      assert.equal(await reader.locator('pre.text-reader-content').textContent(), fullText)
      await containment(`${colorScheme} ${width}px complete output`)
      await page.keyboard.press('Escape')
      await reader.waitFor({ state: 'detached' })
      assert.equal(await full.evaluate(node => node === document.activeElement), true)
      await closeTranscript(opener, dialog)
      // A result already present before the HTTP response still uses the transcript renderer.
      await renderFixture(envelope(messages))
      const reopened = await openTranscript()
      await reopened.dialog.locator('.transcript-result').first().waitFor()
      await closeTranscript(reopened.opener, reopened.dialog)
    }
  }
}

async function checkUnavailableResponses() {
  const cases = [
    [envelope([]), 'No transcript messages were recorded.'],
    [envelope([], { error: 'Agent not found.' }), 'Agent not found.'],
    ['assistant: \nuser:', 'Reload the lab plugin'],
    [
      envelope([
        {
          role: 'assistant',
          toolUses: [
            { tool_use_id: 'empty', tool: 'Bash', input: {}, text: '' },
            { tool_use_id: 'pending', tool: 'Read', input: {} },
          ],
        },
      ]),
      'No text output.',
    ],
  ]
  for (const [answer, expected] of cases) {
    await renderFixture(answer)
    const { opener, dialog } = await openTranscript()
    await dialog.locator('.agent-transcript').waitFor()
    assert.ok((await dialog.textContent()).includes(expected))
    await containment(expected)
    await closeTranscript(opener, dialog)
  }
  await renderFixture()
  const lost = await openTranscript()
  await finishJob('Session disconnected.', 'lost')
  assert.equal(await lost.dialog.getByText('Session disconnected.', { exact: true }).count(), 1)
  await closeTranscript(lost.opener, lost.dialog)
  failRequest = true
  await renderFixture()
  const failed = await openTranscript()
  await failed.dialog.getByText('Fixture request failed.', { exact: true }).waitFor()
  await closeTranscript(failed.opener, failed.dialog)
  failRequest = false
}

async function checkDefaultCommandRenderer() {
  await renderFixture('A normal command response.')
  await page.evaluate(async () => {
    const path = '/runs.js'
    const { sendCommand } = await import(path)
    const target = document.createElement('div')
    target.id = 'default-command-result'
    document.getElementById('main').append(target)
    await sendCommand(globalThis['agentFixture'].state, 'fixture regular-command', target)
  })
  assert.equal(await page.locator('#default-command-result').textContent(), 'A normal command response.')
  assert.equal(await page.locator('#default-command-result .agent-transcript').count(), 0)
}

try {
  server = await startServer({ port: 0, bridgeFile: join(directory, 'bridge.json') })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.route('**/api/command', async route => {
    const { text } = route.request().postDataJSON()
    assert.ok(text === `agent transcript-json ${agentId}` || text === 'fixture regular-command')
    await route.fulfill(
      failRequest ? { status: 500, json: { error: 'Fixture request failed.' } } : { json: { job: latestJob } },
    )
  })
  await page.goto(server.url)
  await checkStructuredFixtures()
  await checkUnavailableResponses()
  await checkDefaultCommandRenderer()
  assert.deepEqual(errors, [])
  console.log(
    'Agent transcripts: real command flow, queued/running states, structured tools/results, complete output, error/empty/legacy handling, focus return and reopens pass in both themes at 1440, 390 and 320px. Default command rendering also passes.',
  )
} finally {
  await browser?.close()
  await server?.close()
  await rm(directory, { recursive: true, force: true })
}
