// Screenshots of the explorer's pages, for reviewing a change to how they look.
// The server starts with the session recorded in scripts/shots-session.json
// (scripts/shots-record.mjs makes it), held as connected and never stale, so
// every render shows the same probes, runs, intercept and reference; then the
// installed Google Chrome, driven by playwright-core, takes each state below in
// each variant. No Claude Code session is started and nothing is asked of one.
//
//   node scripts/shots.mjs --out <folder> [--prefix current] [--states overview,method]
//   node scripts/shots.mjs --serve 4977     the same server, kept running to browse
//
// The declarations come from --types, else MOD_LAB_TYPES, else the server's own
// lookup. Files are written as <out>/<prefix>-<state>-<variant>.png.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { BRIDGE_PROTOCOL, createHub } from '../web/lib/hub.mjs'
import { startServer } from '../web/server.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * The states, each a route of the page and what puts it there: a filter typed
 * into the reference's filter, and the part of the page scrolled to the top.
 * A design that moves the filter or the section changes the selectors here.
 */
export const STATES = [
  { name: 'overview', hash: '#/api' },
  // fs.exists has the recorded intercept in force, the call it refused, and an ok and a refused run.
  // The bench, the right column where the probe, the runs and the intercept are, is scrolled to the top.
  // Where the bench is a pane the height of the window that scrolls on its own (the terminal design), it is already there.
  { name: 'method', hash: '#/$/fs.exists', scrollTo: 'main .bench' },
  { name: 'event', hash: '#/event/session.start', filter: { selector: '#search', text: 'session' } },
  // Not taken unless named in --states (or --states extra for all of them): the explorer's other pages.
  { name: 'session-area', hash: '#/xray', isExtra: true },
  { name: 'build-area', hash: '#/gallery', isExtra: true },
  { name: 'home', hash: '#/', isExtra: true },
  { name: 'probes', hash: '#/probes', isExtra: true },
  { name: 'type', hash: '#/type/SessionStartInput', isExtra: true },
  { name: 'turns', hash: '#/turns', isExtra: true },
  { name: 'streams', hash: '#/streams', isExtra: true },
  { name: 'ledger', hash: '#/ledger', isExtra: true },
  { name: 'workbench', hash: '#/workbench', isExtra: true },
  { name: 'agents', hash: '#/agents', isExtra: true },
  { name: 'keys', hash: '#/keys', isExtra: true },
  { name: 'config', hash: '#/config', isExtra: true },
  { name: 'lessons', hash: '#/learn', isExtra: true },
  { name: 'lesson', hash: '#/learn/tick', isExtra: true },
  { name: 'sandbox', hash: '#/sandbox', isExtra: true },
  { name: 'mods', hash: '#/mods', isExtra: true },
]

export const VARIANTS = [
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
]

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(REPO, 'shots') },
    prefix: { type: 'string', default: 'current' },
    states: { type: 'string' },
    types: { type: 'string' },
    serve: { type: 'string' },
  },
})

/** A hub holding the recorded session, connected for as long as the server runs. */
function recordedHub() {
  const recorded = JSON.parse(readFileSync(join(REPO, 'scripts', 'shots-session.json'), 'utf8'))
  const hub = createHub({ staleMs: Infinity, jobTimeoutMs: Infinity })
  const { session } = recorded
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, ...session, session: session.facts })
  hub.addRuns(client, recorded.runs)
  hub.addTraces(client, recorded.traces)
  hub.addTaps(client, recorded.taps)
  for (const [key, value] of Object.entries(recorded.mirror)) hub.mirror(client, key, value)
  return hub
}

const scratch = mkdtempSync(join(tmpdir(), 'mod-lab-shots-'))
const server = await startServer({
  port: values.serve === undefined ? 0 : Number(values.serve),
  hub: recordedHub(),
  typesPath: values.types ?? process.env.MOD_LAB_TYPES,
  // Its own bridge file, so a session of the person's does not find this server.
  bridgeFile: join(scratch, 'bridge.json'),
  workspace: scratch,
  skillsDir: join(scratch, 'skills'),
})
const reference = server.reference()
console.log(`reference: ${reference === null ? server.catalogProblem() : `${reference.path} (${reference.version})`}`)

if (values.serve !== undefined) {
  console.log(`serving the recorded session at ${server.url}; Ctrl-C stops it`)
  process.on('SIGINT', () => void server.close().then(() => process.exit(0)))
} else {
  const wanted =
    values.states === 'extra'
      ? STATES.filter(state => state.isExtra).map(state => state.name)
      : (values.states?.split(',') ?? STATES.filter(state => !state.isExtra).map(state => state.name))
  const out = resolve(values.out)
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const variant of VARIANTS) {
      const context = await browser.newContext({ viewport: variant.viewport, colorScheme: variant.colorScheme })
      for (const state of STATES.filter(one => wanted.includes(one.name))) {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(String(error)))
        page.on('console', message => message.type() === 'error' && errors.push(message.text()))
        page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
        await page.goto(`${server.url}/${state.hash}`)
        try {
          await page.waitForSelector('main h1', { timeout: 10_000 })
        } catch {
          // A page that never draws its title has usually thrown on load: say what the browser saw.
          throw new Error(
            `${state.name} (${variant.name}): the page drew no heading in main within 10 s. ` +
              (errors.length > 0 ? `The browser reported: ${errors.join('; ')}` : 'The browser reported no error.'),
          )
        }
        if (state.filter) await page.fill(state.filter.selector, state.filter.text)
        if (state.scrollTo) {
          await page.evaluate(selector => {
            document.querySelector(selector)?.scrollIntoView({ block: 'start' })
            // A sticky header would cover the section's top.
            const bar = document.querySelector('body > header')
            if (bar && getComputedStyle(bar).position === 'sticky') window.scrollBy(0, -bar.offsetHeight - 12)
          }, state.scrollTo)
        }
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)
        const path = join(out, `${values.prefix}-${state.name}-${variant.name}.png`)
        await page.screenshot({ path })
        console.log(`${errors.length === 0 ? 'ok  ' : 'ERR '} ${path}${errors.length ? `: ${errors.join('; ')}` : ''}`)
        await page.close()
      }
      await context.close()
    }
  } finally {
    await browser.close()
    await server.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}
