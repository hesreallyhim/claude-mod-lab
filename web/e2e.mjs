// End-to-end check against the real engine: starts the explorer server on a
// free port with a bridge file of its own, starts a headless Claude Code with
// both mods, queues probes as the page would, and checks what comes back.
// The bridge file is the bridge's override, so that session's own explorer
// stays idle. Then a second session with no override, whose own explorer, in
// the bridge's MCP server, serves the page, and whose bridge connects to it.
// `/mod-lab explorer serve` is a plugin command, so the runs make no model
// request. Run with `npm run e2e`.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startServer } from './server.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SERVE_SECONDS = 20

const dir = mkdtempSync(join(tmpdir(), 'mod-lab-e2e-'))
const bridgeFile = join(dir, 'bridge.json')
const server = await startServer({ port: 0, bridgeFile, typesPath: process.env.MOD_LAB_TYPES })
const settings = JSON.stringify({ pluginConfigs: { 'mod-lab-bridge': { options: { bridgeFile } } } })
// mod-lab-target and mod-lab-keys are mod-lab's dependencies: without them it does not load.
const PLUGIN_DIRS = ['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-lab-keys'].flatMap(mod => [
  '--plugin-dir',
  join(REPO, 'mods', mod),
])

const claude = spawn(
  'claude',
  ['-p', ...PLUGIN_DIRS, '--settings', settings, `/mod-lab explorer serve ${SERVE_SECONDS}`],
  {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let output = ''
claude.stdout.on('data', chunk => (output += chunk))
claude.stderr.on('data', chunk => (output += chunk))

async function until(what, check, ms = 15_000) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 100))
  }
}

const failures = []
function expect(isTrue, message) {
  console.log(`${isTrue ? 'ok  ' : 'FAIL'} ${message}`)
  if (!isTrue) failures.push(message)
}

/** Does what `/mod-lab <text>` does, in the session, and answers its text. */
async function command(text) {
  const queued = server.hub.enqueueCommand(text)
  if ('error' in queued) throw new Error(queued.error)
  return until(
    `the command job ${text}`,
    () => server.hub.snapshot().jobs.find(one => one.id === queued.job && one.status === 'done')?.answer,
  )
}

async function runProbe(probe, args) {
  const queued = server.hub.enqueue(probe, args)
  if ('error' in queued) throw new Error(queued.error)
  await until(`the ${probe} job`, () =>
    server.hub.snapshot().jobs.some(one => one.id === queued.job && one.status === 'done'),
  )
  return server.hub.snapshot().runs.findLast(run => run.probe === probe && run.from === 'explorer')
}

try {
  const session = await until(
    'the session to connect',
    () => server.hub.snapshot().session?.isConnected && server.hub.snapshot().session,
  )
  expect(session.probes.length > 0, `the session offered ${session.probes.length} probes through $.lab.probes()`)
  expect(session.facts.cwd === REPO, `the session reported its working directory (${session.facts.cwd})`)
  expect(
    session.lab?.root === join(REPO, 'mods', 'mod-lab'),
    `the hello reported mod-lab's root from $.lab.root(), where the server looks for declarations (${session.lab?.root})`,
  )
  expect(
    typeof session.engine?.version === 'string' && Array.isArray(session.engine.surfaces),
    `the hello reported the engine's version and surfaces (${JSON.stringify(session.engine)})`,
  )

  const cwd = await runProbe('session.cwd', {})
  expect(cwd?.ok === true && cwd.value === REPO, 'session.cwd ran in the session and answered its directory')
  expect(
    cwd?.dispatches?.[0]?.event === 'session.cwd',
    'its dispatch was recorded, so the run happened inside the lab hook',
  )
  expect(cwd?.dispatches?.[0]?.chain.at(-1)?.plugin === 'engine', 'the chain ends at the engine')

  const read = await runProbe('fs.read', { path: 'README.md' })
  const received = read?.dispatches?.[0]?.received
  expect(read?.ok === true, 'fs.read of README.md ran')
  expect(
    received?.path === join(REPO, 'README.md'),
    `hooks saw the path resolved against the working directory (${received?.path})`,
  )

  const forwarded = await until(
    'trace rows',
    () => server.hub.snapshot().traces.length > 0 && server.hub.snapshot().traces,
  )
  expect(
    forwarded.some(row => row.event === 'session.start'),
    'the bridge forwarded the lab trace, session.start included',
  )

  expect(session.interceptable.includes('fs.read'), 'the session offered the events the lab can intercept')
  const listing = await command('list')
  expect(
    listing.startsWith(`${session.probes.length} probes`) && listing.includes('fs:'),
    'a command with no job of its own (/mod-lab list) was answered from the page',
  )
  const answer = await command('intercept fs.read refuse')
  expect(answer.startsWith('Intercepting fs.read refuse'), `an intercept set from the page was answered: ${answer}`)
  const intercepts = () => server.hub.snapshot().mirror.intercepts ?? []
  const listed = await until('the intercepts in force', () => intercepts().length > 0 && intercepts())
  expect(
    listed[0]?.event === 'fs.read' && listed[0]?.behavior === 'refuse',
    'the bridge forwarded the intercepts in force',
  )
  const refused = await runProbe('fs.read', { path: 'README.md' })
  expect(
    refused?.ok === false && refused.dispatches?.[0]?.intercepted === 'refuse',
    'the next fs.read was refused by the lab, and the run says so',
  )
  const tapped = await until('a tap', () => server.hub.snapshot().taps.find(tap => tap.event === 'fs.read'))
  expect(
    tapped.behavior === 'refuse' && tapped.origin === 'mod-lab',
    'the call the intercept acted on was forwarded as a tap',
  )
  const ledger = await command('ledger')
  expect(
    ledger.includes('System prompt sections, by owner') && ledger.includes('Measured by the engine'),
    'the ledger comes back from the session',
  )
  await command('intercept clear')
  const cleared = await until('the intercepts to clear', () => intercepts().length === 0)
  expect(cleared, 'clearing from the page lifts the intercept')
} catch (error) {
  failures.push(error.message)
  console.log(`FAIL ${error.message}`)
  console.log(output)
} finally {
  claude.kill()
  await server.close()
  rmSync(dir, { recursive: true, force: true })
}

/** A port nothing listens on now. */
async function freePort() {
  const probe = createServer()
  await new Promise(done => probe.listen(0, '127.0.0.1', () => done()))
  const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address())
  await new Promise(done => probe.close(() => done()))
  return port
}

/**
 * The session's own explorer: with no override, `/mod-lab explorer` has the
 * bridge's MCP server serve the page, and the bridge connects to it. The
 * session runs in the default permission mode, where the lab's calls on that
 * server need mod-lab's grant.
 */
async function ownExplorer() {
  const port = await freePort()
  const env = { ...process.env, MOD_LAB_PORT: String(port) }
  for (const name of ['MOD_LAB_BRIDGE_FILE', 'MOD_LAB_OPEN']) delete env[name]
  const args = ['-p', ...PLUGIN_DIRS, '--permission-mode', 'default', `/mod-lab explorer serve ${SERVE_SECONDS}`]
  const own = spawn('claude', args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let ownOutput = ''
  own.stdout.on('data', chunk => (ownOutput += chunk))
  own.stderr.on('data', chunk => (ownOutput += chunk))
  const exited = new Promise(done => own.on('exit', done))
  const page = `http://localhost:${port}`
  try {
    const html = await until('the session to serve its explorer', async () => {
      const answer = await fetch(page).catch(() => null)
      return answer?.status === 200 && answer.text()
    })
    const token = /name="lab-token" content="([^"]+)"/.exec(html)?.[1]
    expect(token !== undefined, `the session's own explorer served the page at ${page}`)
    const api = async (path, body) => {
      const headers = { 'x-lab-token': token, 'content-type': 'application/json' }
      const init = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }
      return (await fetch(`${page}${path}`, init)).json()
    }
    const session = await until('the bridge to find it', async () => (await api('/api/state')).session?.isConnected)
    expect(session, "the session's bridge found it through the MCP server and connected")
    const { job } = await api('/api/run', { probe: 'session.cwd', args: {} })
    const run = await until('the probe', async () => {
      const state = await api('/api/state')
      return (
        state.jobs.some(one => one.id === job && one.status === 'done') &&
        state.runs.findLast(one => one.probe === 'session.cwd')
      )
    })
    expect(run.ok === true && run.value === REPO, 'a probe queued on that page ran in the session')
  } catch (error) {
    failures.push(error.message)
    console.log(`FAIL ${error.message}`)
    console.log(ownOutput)
  } finally {
    own.kill()
    await exited
  }
  const isGone = await until(
    'the page to go with the session',
    async () =>
      !(await fetch(page).then(
        () => true,
        () => false,
      )),
    2_000,
  ).catch(() => false)
  expect(isGone, 'the explorer stopped with its session')
}

await ownExplorer()

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
