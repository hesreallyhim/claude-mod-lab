// End-to-end check of the explorer page in a browser: the server, a headless
// Claude Code with both mods, and the installed Google Chrome driven by
// playwright-core. It runs a probe from the page's own form and checks the
// result card, the live feed, the filter, the tabs, an intercept set and
// cleared from a method's page, a lesson started and checked on save in a
// workspace of its own, the Workshop page's switch, and the console. Makes
// no model requests.
// Run with `npm run e2e-page`; SCREENSHOT=<file.png> keeps a picture of the
// intercept section, and one of the ledger page beside it. PAGE_COVERAGE=1
// (set by `npm run coverage:web -- --page`) also collects the page's coverage:
// see startPageCoverage below.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright-core'

import { startServer } from './server.mjs'
import { checkContentSecurityPolicy } from './e2e-csp.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-page-')))
const bridgeFile = join(dir, 'bridge.json')
// The workspace the page's lessons, Sandbox and Workshop write to: the run's own, not the repository.
const workspace = join(dir, 'workspace')
const skillsDir = join(workspace, '.claude', 'skills')
mkdirSync(join(workspace, 'workshop'), { recursive: true })
mkdirSync(join(workspace, '.claude-mod-lab'), { recursive: true })
const server = await startServer({
  port: 0,
  bridgeFile,
  typesPath: process.env.MOD_LAB_TYPES,
  workspace,
  lessonWorkspace: workspace,
  skillsDir,
})
const settings = JSON.stringify({ pluginConfigs: { 'mod-lab-bridge': { options: { bridgeFile } } } })
const claude = spawn(
  'claude',
  [
    '-p',
    '--plugin-dir',
    join(REPO, 'mods', 'mod-lab'),
    '--plugin-dir',
    join(REPO, 'mods', 'mod-lab-bridge'),
    // mod-lab's dependencies: without them it does not load.
    '--plugin-dir',
    join(REPO, 'mods', 'mod-lab-target'),
    '--plugin-dir',
    join(REPO, 'mods', 'mod-lab-keys'),
    '--settings',
    settings,
    '/mod-lab explorer serve 590',
  ],
  { cwd: workspace, env: { ...process.env, MOD_LAB_LESSONS: workspace }, stdio: 'ignore' },
)

const failures = []
function expect(isTrue, message) {
  console.log(`${isTrue ? 'ok  ' : 'FAIL'} ${message}`)
  if (!isTrue) failures.push(message)
}

async function until(what, check, ms = 15_000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 100))
  }
}

// The page's coverage, collected when PAGE_COVERAGE is set; a run without it is unchanged.
// - JavaScript: Chrome's V8 coverage of each file served from web/public/, under its file:// URL,
//   written in the format Node writes for NODE_V8_COVERAGE into c8's temporary folder (coverage/tmp,
//   from reports-dir in .c8rc.json), where `c8 report` reads it beside the web tests' coverage.
// - CSS: Chrome's rule-usage tracking, written to coverage/css-rules.json: per stylesheet, each rule's
//   line, selector, the blocks around it (an @media, say) and whether any page of the run used it.
//   The run visits the pages in the light colour scheme only, so rules for the dark one show as unused.
const PUBLIC = join(REPO, 'web', 'public')
const COVERAGE = join(REPO, 'coverage')

/** @param {import('playwright-core').Page} page */
async function startPageCoverage(page) {
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  const cdp = await page.context().newCDPSession(page)
  const sheetUrls = new Map()
  cdp.on('CSS.styleSheetAdded', ({ header }) => sheetUrls.set(header.styleSheetId, header.sourceURL))
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  await cdp.send('CSS.startRuleUsageTracking')
  return async () => {
    const scripts = await page.coverage.stopJSCoverage()
    const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking')
    await cdp.detach()
    const result = scripts.flatMap(({ url, scriptId, functions }) => {
      const file = publicFile(url)
      return file === null ? [] : [{ scriptId, url: pathToFileURL(file).href, functions }]
    })
    mkdirSync(join(COVERAGE, 'tmp'), { recursive: true })
    writeFileSync(join(COVERAGE, 'tmp', `coverage-page-${process.pid}-${Date.now()}.json`), JSON.stringify({ result }))
    const stylesheets = ruleRecord(
      ruleUsage.map(rule => ({ ...rule, file: publicFile(sheetUrls.get(rule.styleSheetId)) })),
    )
    writeFileSync(
      join(COVERAGE, 'css-rules.json'),
      `${JSON.stringify({ colorSchemes: ['light'], date: new Date().toISOString(), stylesheets }, null, 2)}\n`,
    )
    const counts = Object.entries(stylesheets).map(([file, { used, unused }]) => `${file} ${used}/${used + unused}`)
    console.log(`page coverage: ${result.length} scripts in coverage/tmp; rules used, in coverage/css-rules.json:`)
    console.log(`  ${counts.join(', ')}`)
  }
}

/** The file under web/public/ that a URL the server served stands for, or null. */
function publicFile(url) {
  if (!url?.startsWith(server.url)) return null
  const file = join(PUBLIC, decodeURIComponent(new URL(url).pathname))
  return file.startsWith(`${PUBLIC}/`) && existsSync(file) ? file : null
}

/**
 * The record of rule usage: every style rule of every stylesheet in web/public/, read from its text, and
 * whether Chrome reported it used in any document of the run. Chrome reports only the rules it used, by the
 * offset where each starts, so a reported offset that is not the start of a rule read here is counted as
 * unmatched, and printed, rather than dropped.
 * @param {{ file: string | null, startOffset: number, used: boolean }[]} usage
 */
function ruleRecord(usage) {
  const usedByFile = new Map()
  for (const { file, startOffset, used } of usage) {
    if (file === null) continue
    if (!usedByFile.has(file)) usedByFile.set(file, new Set())
    if (used) usedByFile.get(file).add(startOffset)
  }
  const record = {}
  for (const name of readdirSync(PUBLIC)
    .filter(name => name.endsWith('.css'))
    .sort()) {
    const file = join(PUBLIC, name)
    const used = usedByFile.get(file) ?? new Set()
    const rules = styleRules(readFileSync(file, 'utf8')).map(rule => ({ ...rule, used: used.has(rule.offset) }))
    const starts = new Set(rules.map(rule => rule.offset))
    const unmatched = [...used].filter(offset => !starts.has(offset))
    if (unmatched.length > 0) console.log(`page coverage: ${name}: used rules at offsets not read: ${unmatched}`)
    const usedCount = rules.filter(rule => rule.used).length
    record[relative(REPO, file)] = {
      loaded: usedByFile.has(file),
      used: usedCount,
      unused: rules.length - usedCount,
      unmatched,
      rules,
    }
  }
  return record
}

/**
 * The style rules in a stylesheet's text, in order, in one pass that skips comments and strings: for each, the
 * offset and line where its selector starts, the selector, and the preludes of the blocks around it (an @media,
 * say, or the parent rule of a nested one). At-rules are not listed themselves, nor the frames of @keyframes.
 * @param {string} text
 */
function styleRules(text) {
  const rules = []
  const around = []
  const clean = part =>
    part
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
  let line = 1
  let start = -1
  let startLine = 1
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      const comment = text.slice(at, end < 0 ? text.length : end + 2)
      line += comment.split('\n').length - 1
      at += comment.length - 1
      continue
    }
    if (char === '\n') line++
    if (start < 0 && !/\s/.test(char)) [start, startLine] = [at, line]
    if (char === '"' || char === "'") {
      let end = at + 1
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1
      at = end
    } else if (char === '{') {
      const prelude = clean(text.slice(start, at))
      if (!prelude.startsWith('@') && !around.some(block => block.startsWith('@keyframes')))
        rules.push({ offset: start, line: startLine, selector: prelude, within: [...around] })
      around.push(prelude)
      start = -1
    } else if (char === '}') {
      around.pop()
      start = -1
    } else if (char === ';') start = -1
  }
  return rules
}

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  await until('the session to connect', () => server.hub.snapshot().session?.isConnected)
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  const stopPageCoverage = process.env.PAGE_COVERAGE ? await startPageCoverage(page) : null

  await page.goto(server.url)
  await page.waitForSelector('main .home')
  expect(
    (await page.locator('#areas a').allTextContents()).join(', ') === 'Mod API, Session, Build' &&
      (await page.locator('main .home .card').count()) === 3,
    'the home page and the header offer the three areas',
  )
  expect(!(await page.isVisible('#nav')) && !(await page.isVisible('#feed')), 'the home page has neither column')

  await page.goto(`${server.url}/#/$/fs.read`)
  await page.waitForSelector('form.probe')
  expect(
    (await page.textContent('#areas a[aria-current=page]')) === 'Mod API' && !(await page.isVisible('#feed')),
    "a method's page is in the Mod API area, which has no feed",
  )
  expect(
    (await page.textContent('#session')).includes(server.hub.snapshot().session.facts.id.slice(0, 8)),
    'the header names the connected session',
  )
  const engine = await page.textContent('#engine .tip-value')
  expect(
    engine.startsWith(`Claude Code ${server.hub.snapshot().session.engine.version}`),
    `the header shows the session's build (${engine})`,
  )

  await page.fill('form.probe input[name=path]', join(REPO, 'package.json'))
  await page.click('form.probe button[type=submit]')
  await page.waitForSelector('form.probe .result article.run', { timeout: 15_000 })
  const card = await page.textContent('form.probe .result article.run')
  expect(card.includes('fs.read') && card.includes('ok'), "the form's run comes back as a card under it")
  expect(card.includes(join(REPO, 'package.json')), 'the card shows the path the hooks saw, resolved')

  await page.waitForFunction(() => document.querySelector('#feed-body details.trace')?.textContent.includes('fs.read'))
  expect(true, "the feed has the run on top, for the Session area's pages")

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.click('form.probe .result article.run button.quiet')
  const ejected = await page.evaluate(() => navigator.clipboard.readText())
  expect(
    ejected.includes("on('fs.read', () => (") && ejected.includes('package.json'),
    'a run card copies its calls as bottom hooks for a test',
  )

  await page.fill('#search', 'toast')
  // The index's links are found by where they go: their text carries the run glyph and the muted parts apart.
  const hrefs = await page.locator('#tree a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(
    hrefs.includes('#/$/ui.toast') &&
      !hrefs.includes('#/$/session.cwd') &&
      (await page.textContent('#tree-count')).includes('match'),
    'the filter narrows the reference, and says how much of it matches',
  )

  await page.goto(`${server.url}/#/api`)
  await page.locator('main button.tile', { hasText: '$.fs' }).click()
  const narrowed = await page.locator('#tree a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(
    (await page.inputValue('#search')) === 'fs.' &&
      narrowed.includes('#/$/fs.exists') &&
      !narrowed.includes('#/$/ui.toast'),
    "a noun's tile on the area's first page narrows the reference to it",
  )
  await page.fill('#search', '')

  await page.goto(`${server.url}/#/$/process.spawn`)
  await page.waitForSelector('main .cross a')
  expect(
    (await page.locator('main .cross a').allTextContents()).includes('Streams'),
    "a method's page links to the Session pages that show it",
  )
  await page.click('main .cross a')
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Streams')
  expect(
    (await page.textContent('#areas a[aria-current=page]')) === 'Session' &&
      (await page.locator('main .cross a').allTextContents()).includes('process.spawn') &&
      (await page.locator('#tree a').allTextContents()).includes('Turn timeline'),
    "a Session page lists the area's pages on the left and links back to the parts of $ it shows",
  )
  await page.click('#tab-trace')
  expect((await page.locator('#feed-body details.trace').count()) > 0, 'the session events tab lists traced events')
  await page.click('#tab-runs')

  await page.goto(`${server.url}/#/$/fs.exists`)
  await page.waitForSelector('form.intercept')
  await page.selectOption('form.intercept select[name=behavior]', 'refuse')
  await page.click('form.intercept button[type=submit]')
  await page.waitForSelector('form.intercept .result .answer', { timeout: 15_000 })
  expect(
    (await page.textContent('form.intercept .result .answer')).startsWith('Intercepting fs.exists refuse'),
    'an intercept set from the form is answered by the session',
  )
  await page.waitForFunction(() =>
    document.querySelector('[data-intercept-state]')?.textContent.includes('In force: refuse'),
  )
  expect(true, 'the method page shows the intercept in force')
  await page.click('form.probe:not(.intercept) button[type=submit]')
  await page.waitForSelector('form.probe:not(.intercept) .result article.run.failed', { timeout: 15_000 })
  expect(
    (await page.textContent('form.probe:not(.intercept) .result article.run')).includes('refused it'),
    "the probe run next is refused, in the lab's words",
  )
  await page.waitForFunction(() =>
    document.querySelector('[data-intercept-state] details.trace')?.textContent.includes('fs.exists'),
  )
  expect(true, 'the call the intercept acted on is listed under it')
  if (process.env.SCREENSHOT)
    await page.locator('section', { has: page.locator('form.intercept') }).screenshot({ path: process.env.SCREENSHOT })
  await page.goto(`${server.url}/#/turns`)
  await page.click('#tab-taps')
  expect((await page.locator('#feed-body details.trace').count()) > 0, 'the Intercepted tab lists it')
  expect(
    (await page.textContent('#feed-body .census')).includes('fs.exists 1 call, made by mod-lab 1'),
    'and adds the calls up in its census',
  )
  await page.click('#tab-runs')
  await page.goto(`${server.url}/#/$/fs.exists`)
  await page.waitForSelector('[data-intercept-state] button')
  await page.click('[data-intercept-state] button')
  await page.waitForFunction(() =>
    document.querySelector('[data-intercept-state]')?.textContent.includes('No intercept on this event'),
  )
  expect(true, 'Clear lifts it')

  await page.goto(`${server.url}/#/ledger`)
  await page.click('main button')
  await page.waitForSelector('main .result .answer', { timeout: 15_000 })
  expect(
    (await page.textContent('main .result .answer')).includes('Measured by the engine'),
    'the ledger page measures the session',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-ledger.png') })

  await page.goto(`${server.url}/#/turns`)
  await page.waitForSelector('main h1')
  expect(
    (await page.textContent('main')).includes('No turn traced yet'),
    'the turn timeline says when there is no turn yet (a turn needs a model request)',
  )

  await page.goto(`${server.url}/#/mods`)
  await page.waitForSelector('main article.run', { timeout: 60_000 })
  expect(
    (await page.textContent('main')).includes('mod-lab') &&
      (await page.locator('main .mod-capabilities li').count()) > 0,
    "the Installed mods page reads each hooks module's hooks and calls",
  )

  await page.goto(`${server.url}/#/gallery`)
  await page.waitForSelector('table.matrix')
  const rasterRow = await page
    .locator('table.matrix tr', { has: page.locator('a', { hasText: 'Raster' }) })
    .locator('td')
    .allTextContents()
  expect(
    rasterRow.join(' ') === 'Raster ✓ · · ·',
    `the Gallery page's matrix has Raster on the terminal alone (${rasterRow.join(' ')})`,
  )
  expect(
    (await page.locator('section.technique').count()) >= 7 && (await page.locator('main p.error').count()) === 0,
    "it shows each of the gallery's techniques, its source found",
  )
  await page.locator('#gallery-raster details.excerpt summary').first().click()
  expect(
    (await page.textContent('#gallery-raster details.excerpt pre')).includes('Raster'),
    "a technique's source opens beneath it",
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url })
  await page.locator('#gallery-raster button', { hasText: 'Copy as a mod' }).click()
  await page.waitForFunction(
    () => document.querySelector('#gallery-raster .copy-status')?.textContent.includes('Copied'),
    null,
    { timeout: 5_000 },
  )
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(
    copied === (await page.textContent('#gallery-raster details.snippet pre')) &&
      copied.includes("cat > workshop/raster-mod/hooks/register.tsx <<'MOD'"),
    "Copy as a mod puts the snippet that writes the technique's mod on the clipboard",
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-gallery.png') })
  const raster = page.locator('[data-component="raster-mod"]')
  await raster.getByRole('button', { name: 'Add to project' }).click()
  await raster.getByRole('button', { name: 'Remove' }).waitFor({ timeout: 20_000 })
  expect(
    existsSync(join(skillsDir, 'raster-mod', 'hooks', 'register.tsx')),
    `Add to project copies the technique's mod into the skills folder (${(await raster.innerText()).replace(/\n+/g, ' | ')})`,
  )
  await raster.getByRole('button', { name: 'Remove' }).click()
  await raster.getByRole('button', { name: 'Add to project' }).waitFor({ timeout: 20_000 })
  expect(!existsSync(join(skillsDir, 'raster-mod')), 'Remove deletes the copy it made')

  // The workbench in free mode: the lab's intercept answers, so nothing is sent or spent.
  await page.goto(`${server.url}/#/workbench`)
  await page.click('button[data-free]')
  await page.waitForFunction(() => document.querySelector('#spend')?.textContent.includes('free mode'), null, {
    timeout: 15_000,
  })
  expect(true, 'free mode set from the workbench shows in the header')
  await page.click('form.workbench button[type=submit]')
  await page.waitForSelector('form.workbench .result article.run', { timeout: 15_000 })
  expect(
    (await page.textContent('form.workbench .result article.run')).includes('no request was sent'),
    "the workbench's completion is answered by free mode",
  )
  await page.waitForFunction(() => document.querySelector('table.calls tr.unsent') !== null, null, { timeout: 15_000 })
  expect(
    (await page.textContent('#spend')).startsWith('model calls 1 (0 sent)'),
    'the meter counts the call as made and not sent',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-workbench.png') })
  await page.click('button[data-free]')
  await page.waitForFunction(() => !document.querySelector('#spend')?.textContent.includes('free mode'), null, {
    timeout: 15_000,
  })

  // Agents, with nothing spawned: registering and hiding cost no tokens.
  await page.goto(`${server.url}/#/agents`)
  await page.getByText('Register an agent type', { exact: true }).click()
  await page.locator('form.probe', { hasText: 'Register' }).locator('button[type=submit]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-live="agents"]')?.textContent.includes('mod-lab:counter'),
    null,
    { timeout: 15_000 },
  )
  expect(true, 'a type registered from the Agents page is listed under its full name')
  await page.getByText('Hide types and route spawns', { exact: true }).click()
  await page.locator('form.probe', { hasText: 'Hide from the model' }).locator('button[value=hide]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-live="agents"]')?.textContent.includes('Hidden from the model: Plan'),
    null,
    { timeout: 15_000 },
  )
  expect(true, 'hiding a built-in type from the model shows on the page')
  await page.locator('form.probe', { hasText: 'Hide from the model' }).locator('button[value=show]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-live="agents"]')?.textContent.includes('Hidden from the model: none'),
    null,
    { timeout: 15_000 },
  )

  // The X-ray: a note for the model and a notice for the person, added from the page, cost nothing.
  await page.goto(`${server.url}/#/xray`)
  await page.getByText('Add a note or notice', { exact: true }).click()
  await page.fill('form.inline-form >> nth=0 >> input', 'note-x1 for the model')
  await page.locator('form.inline-form').nth(0).locator('button').click()
  await page.fill('form.inline-form >> nth=1 >> input', 'notice-x2 for the person')
  await page.locator('form.inline-form').nth(1).locator('button').click()
  // The session's own start-up rows are there already; wait for the two added here.
  await page.waitForFunction(
    () =>
      ['note-x1', 'notice-x2'].every(text =>
        [...document.querySelectorAll('table.rows tbody tr')].some(row => row.textContent.includes(text)),
      ),
    null,
    { timeout: 15_000 },
  )
  const readerOf = text =>
    page.locator('table.rows tbody tr', { hasText: text }).first().locator('.reader').textContent()
  expect(
    (await readerOf('note-x1')) === 'Model only' && (await readerOf('notice-x2')) === 'Person only',
    'the X-ray shows a note for the model and a notice for the person',
  )

  // The compaction section: the lab's compactor turned on from the page, and a compaction asked for with two presses.
  await page.fill('section.compactor input[name=keep]', '2')
  await page.locator('section.compactor button[value=on]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-live="compaction"]')?.textContent.includes('compactor is on'),
    null,
    { timeout: 15_000 },
  )
  expect(true, "the lab's compactor turned on from the X-ray page shows as on")
  const compactButton = page.locator('section.compactor > button')
  await compactButton.click()
  expect(
    (await compactButton.textContent()).startsWith('Press again'),
    'the first press of Compact now only asks for a second',
  )
  await compactButton.click()
  // A headless session's serve command holds the turn, so the engine refuses the compaction; the answer is shown.
  await page.waitForFunction(
    () => /compacted/i.test(document.querySelector('section.compactor .result')?.textContent ?? ''),
    null,
    { timeout: 15_000 },
  )
  expect(true, 'the second press asks the session to compact, and its answer is shown')
  // How a compaction is drawn, from a value put in the mirror as the bridge would send it.
  const brief = (role, isKept, chars) => ({ role, chars, tools: 0, results: 0, preview: `${role}-${chars}`, isKept })
  const before = [
    brief('user', true, 40),
    brief('assistant', false, 900),
    brief('user', false, 30),
    brief('assistant', false, 1200),
    brief('user', true, 50),
    brief('assistant', true, 300),
  ]
  const after = [
    brief('user', true, 40),
    brief('user', false, 200),
    brief('user', true, 50),
    brief('assistant', true, 300),
  ]
  const compaction = {
    at: Date.now(),
    trigger: 'manual',
    agentId: null,
    by: 'mod-lab',
    before,
    after,
    tokensBefore: 31_000,
    tokensAfter: 30_200,
    sizedBy: 'request',
    summarizer: null,
    skipped: null,
  }
  server.hub.mirror(server.hub.snapshot().session.client, 'compactor', { keep: 2, compactions: [compaction] })
  await page.waitForSelector('article.compaction .strip')
  expect(
    (await page.textContent('article.compaction header')).includes(
      `by mod-lab: ${before.length} messages to ${after.length}; a request's whole input 31,000 tokens before, 30,200 after; no model call`,
    ),
    'a compaction is drawn with who answered it, its messages and tokens',
  )
  expect(
    (await page.locator('article.compaction .msg.dropped').count()) === before.filter(one => !one.isKept).length,
    'the dropped messages are marked in the strip before',
  )
  expect(
    (await page.locator('article.compaction .msg.built').count()) === after.filter(one => !one.isKept).length,
    'the message written for the compaction is marked in the strip after',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-xray.png') })

  // The Streams page: a spawn run from its form, its pieces on one time axis, stdout and stderr apart.
  await page.goto(`${server.url}/#/streams`)
  await page.selectOption('form.inline-form select[name=argv]', {
    label: "sh -c 'echo to stdout; echo to stderr >&2; exit 3'",
  })
  await page.click('form.inline-form button[type=submit]')
  await page.waitForSelector('[data-live="streams"] .stream-axis .tick', { timeout: 15_000 })
  const spawned = page.locator('[data-live="streams"] article.run').first()
  expect(
    (await spawned.locator('.tick.stdout').count()) === 1 && (await spawned.locator('.tick.stderr').count()) === 1,
    "a spawn run's pieces are drawn on its time axis, stdout and stderr apart",
  )
  expect((await spawned.textContent()).includes('exit code 3'), 'and how the child ended')
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-streams.png') })

  // The Prompt box page: a fill from its form reaches the session, which has no box when headless.
  await page.goto(`${server.url}/#/keys`)
  await page.locator('summary', { hasText: 'Try these' }).click()
  await page.fill('form.inline-form >> nth=0 >> input[name=text]', 'filled-f1 from the page')
  await page.locator('form.inline-form').nth(0).locator('button').click()
  await page.waitForSelector('main .result article.run', { timeout: 15_000 })
  expect(
    (await page.textContent('main .result article.run')).includes('no_composer'),
    'a fill from the Prompt box page runs in the session, which says it has no box',
  )
  const tries = await page.locator('ol.tries > li').count()
  expect(
    tries > 0 && (await page.locator('ol.tries > li.done').count()) === 0,
    `the Prompt box page's walkthrough lists its ${tries} tries, none done where the session has no box`,
  )

  // The Settings page: the rows read when asked, by owner. Nothing is set: that would write the person's settings.
  await page.goto(`${server.url}/#/config`)
  await page.locator('main button', { hasText: 'Read the settings' }).click()
  await page.waitForSelector('[data-live="config"] table.rows tbody tr', { timeout: 15_000 })
  expect(
    (await page.locator('[data-live="config"] h3').first().textContent()).startsWith('engine (core)'),
    "the Settings page lists the session's /config rows by owner, the engine's first",
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-config.png') })

  // The Sandbox page, on a folder of the run's own.
  await page.goto(`${server.url}/#/sandbox`)
  await page.locator('main button', { hasText: 'Save' }).click()
  await page.waitForFunction(
    () => document.querySelector('main .result')?.textContent.includes('The validator passes it.'),
    null,
    { timeout: 30_000 },
  )
  expect(
    (await page.textContent('main .result')).includes('command.run{command=sandbox-mod}'),
    'the Sandbox page saves the blank mod and shows what the validator reads in it',
  )
  await page.selectOption('main select[name=start]', 'raster-mod')
  await page.locator('main button', { hasText: 'Load' }).click()
  await page.locator('main button', { hasText: 'Run tests' }).click()
  await page.waitForSelector('main ul.tests li', { timeout: 60_000 })
  const tests = await page.locator('main ul.tests li').allTextContents()
  expect(
    tests.length === 3 && tests.every(line => line.startsWith('✓')),
    `a template loaded into the sandbox is saved and its tests pass (${tests.join(' | ')})`,
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-sandbox.png') })

  await page.goto(`${server.url}/#/learn`)
  await page.waitForSelector('ul.lessons li')
  expect((await page.locator('ul.lessons li').count()) >= 7, 'the Lessons page lists the lessons')
  await page.click('ul.lessons a[href="#/learn/fence"]')
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent.startsWith('fence'))
  expect((await page.locator('main h2').count()) >= 6, "a lesson's README is drawn on its page, step by step")
  await page.locator('main button.inline').first().click()
  await page.waitForFunction(
    () => /ok, see Runs|failed, see Runs/.test(document.querySelector('main .inline-result')?.textContent ?? ''),
    null,
    { timeout: 15_000 },
  )
  expect(true, "a /mod-lab command in a lesson's text runs in the session from its button")
  await page.locator('main .md-code-block button.copy').first().click()
  await page.waitForFunction(
    () => document.querySelector('main .md-code-block button.copy')?.textContent === 'Copied',
    null,
    { timeout: 5_000 },
  )
  const block = await page.evaluate(() => navigator.clipboard.readText())
  expect(
    block.length > 0 && block === (await page.textContent('main .md-code-block pre')),
    "a lesson's code block copies its text from the button in its corner",
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-lesson.png') })

  await page.goto(`${server.url}/#/learn/only-mine`)
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent.startsWith('only-mine'))
  await page.locator('main details summary', { hasText: 'why it works' }).click()
  await page.locator('main button.inline', { hasText: 'set' }).first().click()
  await page.waitForSelector('main .inline-answer summary', { timeout: 15_000 })
  expect(
    (await page.textContent('main .inline-answer summary')).startsWith('Intercepting session.cwd watch'),
    "a lesson's /mod-lab intercept is done in the session and its answer shown beside the button",
  )
  if (process.env.SCREENSHOT) {
    await page.locator('main .inline-answer summary').click()
    await page
      .locator('main details', { has: page.locator('.inline-answer') })
      .first()
      .screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-command.png') })
  }
  server.hub.enqueueCommand('intercept clear')

  // Tutorial 1 has no starter: its page makes its folder with the manifest, checks it, and checks it again on a save.
  await page.goto(`${server.url}/#/learn/stopwatch`)
  await page.locator('main button', { hasText: `Start: make ${join(workspace, 'workshop', 'stopwatch')}` }).click()
  await page.waitForFunction(
    () => document.querySelector('main .result pre')?.textContent.includes('hooks/hooks.json is missing'),
    null,
    { timeout: 30_000 },
  )
  const stopwatch = join(workspace, 'workshop', 'stopwatch')
  expect(
    JSON.parse(readFileSync(join(stopwatch, '.claude-plugin', 'plugin.json'), 'utf8')).name === 'stopwatch',
    "a lesson started from its page has its folder and manifest in workshop/, and the page shows the checker's report",
  )
  mkdirSync(join(stopwatch, 'hooks'))
  writeFileSync(
    join(stopwatch, 'hooks', 'register.ts'),
    "import type { Register } from 'claude-code'\n\nexport const register: Register = on => {}\n",
  )
  writeFileSync(join(stopwatch, 'hooks', 'hooks.json'), '{ "modules": ["./register.ts"] }\n')
  await page.waitForFunction(
    () => /✓ 1\. The folder/.test(document.querySelector('main .result pre')?.textContent ?? ''),
    null,
    { timeout: 60_000 },
  )
  expect(true, 'a save in the folder is checked while the page is open, and the page shows the new report')
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-checked.png') })

  // The Workshop page's switch turns the mod off for the workspace, and on again. Its reload is the session's last job.
  await page.goto(`${server.url}/#/workshop`)
  const row = page.locator('main tr[data-mod="stopwatch"]')
  await row.locator('input[role=switch]').uncheck()
  await row.locator('label.switch', { hasText: 'off' }).waitFor({ timeout: 15_000 })
  const localSettings = () => JSON.parse(readFileSync(join(workspace, '.claude', 'settings.local.json'), 'utf8'))
  expect(
    localSettings().enabledPlugins?.['stopwatch@inline'] === false,
    "the Workshop page lists the workshop's mod, and its switch turns it off in the workspace's local settings",
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-workshop.png') })
  await row.locator('input[role=switch]').check()
  await row.locator('label.switch', { hasText: 'on' }).waitFor({ timeout: 15_000 })
  expect(localSettings().enabledPlugins === undefined, 'switched on again, its entry goes')

  await page.goto(`${server.url}/#/type/SessionRepo`)
  await page.waitForSelector('pre.declaration')
  expect(!(await page.textContent('main')).includes('[object'), 'a type page draws its declaration and doc text')

  expect(errors.length === 0, `no console errors${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`)
  await checkContentSecurityPolicy(page, expect)
  await stopPageCoverage?.()
} catch (error) {
  failures.push(error.message)
  console.log(`FAIL ${error.message}`)
} finally {
  await browser?.close()
  claude.kill()
  await server.close()
  rmSync(dir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
