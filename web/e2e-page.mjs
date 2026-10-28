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
import { checkApi } from './e2e-page-api.mjs'
import { checkSessionOverview, checkSessionTools } from './e2e-page-session.mjs'
import { checkGallery, checkBuild } from './e2e-page-build.mjs'
import { stage } from './e2e-page-helpers.mjs'

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

  const ctx = { page, server, expect, workspace, REPO }
  await stage('API reference, runs, and intercepts', () => checkApi(ctx))
  await stage('Session overview', () => checkSessionOverview(ctx))
  await stage('Gallery', () => checkGallery(ctx))
  await stage('Session tools', () => checkSessionTools(ctx))
  await stage('Sandbox, lessons, and Workshop', () => checkBuild(ctx))

  await page.goto(`${server.url}/#/type/SessionRepo`)
  await page.waitForSelector('pre.declaration')
  expect(!(await page.textContent('main')).includes('[object'), 'a type page draws its declaration and doc text')

  expect(errors.length === 0, `no console errors${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`)
  await checkContentSecurityPolicy(page, expect)
  await stopPageCoverage?.()
} catch (error) {
  failures.push(error.message)
  console.error('FAIL', error)
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
