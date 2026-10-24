// Records the session that scripts/shots.mjs replays: the explorer server and a
// headless Claude Code with the lab and the bridge, as web/e2e-page.mjs starts
// them, a few probe runs and an intercept on fs.exists, then the server's state
// written to scripts/shots-session.json with the repository's and the home
// folder's paths replaced. Makes no model requests. Run it again when a new
// Claude Code build changes the probes or the runs:
// `node scripts/shots-record.mjs`.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startServer } from '../web/server.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = join(REPO, 'scripts', 'shots-session.json')
const STAND_IN = { repo: '/Users/you/mods', home: '/Users/you' }

const dir = mkdtempSync(join(tmpdir(), 'mod-lab-record-'))
const bridgeFile = join(dir, 'bridge.json')
const server = await startServer({
  port: 0,
  bridgeFile,
  typesPath: process.env.MOD_LAB_TYPES,
  workspace: REPO,
  skillsDir: join(dir, 'skills'),
})
const settings = JSON.stringify({ pluginConfigs: { 'mod-lab-bridge': { options: { bridgeFile } } } })
const claude = spawn(
  'claude',
  [
    '-p',
    ...['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-lab-keys'].flatMap(mod => [
      '--plugin-dir',
      join(REPO, 'mods', mod),
    ]),
    '--settings',
    settings,
    '/mod-lab explorer serve 60',
  ],
  { cwd: REPO, stdio: 'ignore' },
)

async function until(what, check, ms = 30_000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 100))
  }
}

const { hub } = server
async function run(probe, args) {
  const { job } = hub.enqueue(probe, args)
  const settled = await hub.settled(job, 20_000)
  console.log(`${probe}: ${settled?.status ?? 'no answer'}`)
}
async function command(text) {
  const { job } = hub.enqueueCommand(text)
  const settled = await hub.settled(job, 20_000)
  console.log(`/mod-lab ${text}: ${settled?.answer ?? settled?.status ?? 'no answer'}`)
}

try {
  await until('the session to connect', () => hub.snapshot().session?.isConnected)
  await run('session.cwd', {})
  await run('fs.read', { path: 'package.json' })
  await run('fs.exists', { path: 'README.md' })
  await command('intercept fs.exists refuse lab')
  await run('fs.exists', { path: 'package.json' })
  // The taps and the mirrored intercepts follow the runs on the bridge's next ticks.
  await until('the intercept to be mirrored', () => (hub.snapshot().mirror.intercepts ?? []).length > 0)
  await until('the tap', () => hub.snapshot().taps.length > 0)
  // One line: the file is recorded, never edited, and the line limit counts lines.
  const text = JSON.stringify(hub.snapshot()).replaceAll(REPO, STAND_IN.repo).replaceAll(homedir(), STAND_IN.home)
  writeFileSync(OUT, `${text}\n`)
  console.log(`wrote ${OUT}`)
} finally {
  claude.kill()
  await server.close()
  rmSync(dir, { recursive: true, force: true })
}
