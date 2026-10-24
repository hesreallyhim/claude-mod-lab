// The two roots end to end: the server and the checker run with a temporary
// workspace apart from the repository, and what they write lands there alone.
// Runs the checker, so `claude` must be on the path.

import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { after, before, test } from 'node:test'

import { BRIDGE_PROTOCOL } from '../../web/lib/hub.mjs'
import { makeWorkspace } from '../../web/lib/roots.mjs'
import { startServer } from '../../web/server.mjs'
import { loadLessons } from '../lib/lessons.mjs'

const run = promisify(execFile)
const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CHECKER = join(REPO, 'learn', 'check.mjs')
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-roots-')))
const workspace = join(scratch, 'workspace')
const home = join(scratch, 'home')
mkdirSync(workspace)
mkdirSync(home)
const typesPath = join(scratch, 'claude-code.d.ts')
writeFileSync(typesPath, `// Written by Claude Code 0.0.7.\ndeclare module 'claude-code' { export interface CoreEngineInterface {} }\n`)

// Any challenge with a starter of its own.
const challenge = loadLessons(join(REPO, 'learn')).find(lesson => lesson.kind === 'challenge' && lesson.starter !== null)

/** What git sees in the repository, ignored files included, and the times of the folders a stray write would change. */
function repositoryState() {
  const status = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--ignored'], { encoding: 'utf8' })
  const stamps = ['workshop', '.claude-mod-lab', '.claude-mod-lab/progress.json', '.claude', '.claude/skills'].map(path =>
    existsSync(join(REPO, path)) ? `${path} ${statSync(join(REPO, path)).mtimeMs}` : `${path} none`,
  )
  return [status, ...stamps].join('\n')
}

/** This process's environment and `extra`, without MOD_LAB_WORKSPACE, so a child takes its working directory. */
function withoutWorkspace(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.MOD_LAB_WORKSPACE
  return env
}

/** The checker as a person runs it, from `cwd`. Answers its output and exit code. */
async function checker(args, { cwd, env = {} }) {
  try {
    const { stdout } = await run(process.execPath, [CHECKER, ...args], { cwd, env: withoutWorkspace({ NO_COLOR: '1', ...env }), timeout: 120_000 })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

let atStart = ''
let server

before(async () => {
  atStart = repositoryState()
  // Lesson setup and the project destination are explicit, as in init-lessons followed by run.
  makeWorkspace(workspace)
  server = await startServer({ port: 0, typesPath, workspace, lessonWorkspace: workspace,
    installed: async () => ({ copies: [], problem: null }),
  })
})

after(async () => {
  await server?.close()
})

const page = (path, body) =>
  fetch(`${server.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-lab-token': server.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(res => res.json())

test('the server uses explicitly selected project and lesson destinations', async () => {
  assert.deepEqual(await page('/api/context'), { project: workspace, lessonWorkspace: workspace, protocol: BRIDGE_PROTOCOL })
})

test('starting from the page copies a reference outside workshop and preserves existing work on subsequent starts', async () => {
  const lesson = await page('/api/lesson?id=tick')
  assert.equal(lesson.solutionFolder, join(workspace, 'solutions', 'tick'))
  assert.equal(lesson.hasSolution, false)
  assert.equal(existsSync(lesson.solutionFolder), false, 'reading a lesson does not copy its reference')
  const started = await page('/api/lesson/start?id=tick', { lessonWorkspace: workspace })
  assert.equal(started.made, 'starter')
  assert.equal(started.solutionFolder, lesson.solutionFolder)
  const source = join(started.folder, 'hooks', 'register.tsx')
  const reference = join(started.solutionFolder, 'hooks', 'register.tsx')
  assert.match(readFileSync(source, 'utf8'), /Step 4/)
  assert.match(readFileSync(reference, 'utf8'), /timer\?\.cancel\(\)/)
  assert.equal(existsSync(join(started.solutionFolder, '.claude-plugin')), false)
  assert.equal(existsSync(join(started.solutionFolder, 'tsconfig.json')), false)
  writeFileSync(source, `${readFileSync(source, 'utf8')}\n// My work\n`)
  writeFileSync(reference, `${readFileSync(reference, 'utf8')}\n// My notes\n`)
  const again = await page('/api/lesson/start?id=tick', { lessonWorkspace: workspace })
  assert.equal(again.made, null)
  assert.match(readFileSync(source, 'utf8'), /My work/)
  assert.match(readFileSync(reference, 'utf8'), /My notes/)
  assert.equal((await page('/api/lesson?id=tick')).hasSolution, true)
})

test('lessons extending the same mod receive separate reference solutions', async () => {
  const first = await page('/api/lesson/start?id=stopwatch-pane', { lessonWorkspace: workspace })
  const second = await page('/api/lesson/start?id=stopwatch-options', { lessonWorkspace: workspace })
  assert.equal(first.folder, second.folder)
  assert.equal(second.made, null)
  assert.notEqual(first.solutionFolder, second.solutionFolder)
  for (const id of ['stopwatch-pane', 'stopwatch-options']) {
    const lesson = loadLessons(join(REPO, 'learn')).find(one => one.id === id)
    assert.equal(
      readFileSync(join(workspace, 'solutions', id, 'hooks', 'register.tsx'), 'utf8'),
      readFileSync(join(lesson.dir, 'solution', 'hooks', 'register.tsx'), 'utf8'),
    )
  }
})

test('Add to session writes to <workspace>/.claude/skills, and a session running there reloads it', async () => {
  const listed = await page('/api/components')
  assert.equal(listed.dir, join(workspace, '.claude', 'skills'))
  assert.equal(listed.project, workspace)
  const name = listed.components[0].name
  const bridge = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }
  const hello = await fetch(`${server.url}/bridge/hello`, {
    method: 'POST',
    headers: bridge,
    body: JSON.stringify({ protocol: BRIDGE_PROTOCOL, session: { id: 'session-w1', cwd: workspace }, lab: { lessons: workspace } }),
  })
  const { client } = await hello.json()

  const adding = page('/api/components/add', { name, project: listed.project })
  let job = null
  while (job === null) {
    const next = await fetch(`${server.url}/bridge/next?client=${client}`, { headers: bridge })
    if (next.status === 200) job = (await next.json()).job
  }
  await fetch(`${server.url}/bridge/answer`, {
    method: 'POST',
    headers: bridge,
    body: JSON.stringify({ client, job: job.id, text: 'Reloaded: 1 plugin' }),
  })
  const added = await adding

  assert.equal(added.component.isAdded, true)
  assert.deepEqual(added.reload, { isReloaded: true, note: 'Reloaded: 1 plugin' })
  assert.equal(existsSync(join(workspace, '.claude', 'skills', name, '.claude-plugin', 'plugin.json')), true)
})

test("a challenge's starter lands in <workspace>/workshop and its check in <workspace>/.claude-mod-lab/progress.json", async () => {
  const lesson = await page(`/api/lesson?id=${challenge.id}`)
  assert.equal(lesson.folder, join(workspace, 'workshop', challenge.mod))
  const checked = await page(`/api/check?id=${challenge.id}`, { lessonWorkspace: lesson.lessonWorkspace })

  assert.match(checked.report, new RegExp(`Copied the starter to workshop/${challenge.mod}/`))
  assert.equal(existsSync(join(workspace, 'workshop', challenge.mod, '.claude-plugin', 'plugin.json')), true)
  assert.equal(existsSync(join(workspace, 'solutions', challenge.id, 'hooks')), true)
  assert.equal(existsSync(join(workspace, 'solutions', challenge.id, '.claude-plugin')), false)
  const progress = JSON.parse(readFileSync(join(workspace, '.claude-mod-lab', 'progress.json'), 'utf8'))
  const { report, ...summary } = progress.lessons[challenge.id]
  assert.deepEqual(checked.progress, summary)
  assert.equal(progress.current, challenge.id)
  assert.equal(summary.total, challenge.steps.length)
  assert.ok(checked.report.trimEnd().endsWith(report), 'the report recorded is the one the page shows')
})

test('the checker run in the workspace, without MOD_LAB_WORKSPACE, reads the progress there', async () => {
  const listed = await checker([], { cwd: workspace })
  assert.equal(listed.code, 0)
  const line = listed.output.split('\n').find(one => one.trimStart().startsWith(`${challenge.id} `))
  assert.match(line, /\d+\/\d+ checked/)
})

test('the CLI adds a reference for an existing mod without changing it', async () => {
  const cliWorkspace = join(scratch, 'cli-existing')
  makeWorkspace(cliWorkspace)
  const mod = join(cliWorkspace, 'workshop', 'tick')
  mkdirSync(mod, { recursive: true })
  writeFileSync(join(mod, 'my-work.txt'), 'unfinished work')
  const checked = await checker(['tick', '--no-types'], { cwd: cliWorkspace })
  assert.match(checked.output, /Reference solution: solutions\/tick\//)
  assert.equal(readFileSync(join(mod, 'my-work.txt'), 'utf8'), 'unfinished work')
  assert.equal(existsSync(join(mod, '.claude-plugin')), false)
  assert.equal(existsSync(join(cliWorkspace, 'solutions', 'tick', 'hooks', 'register.tsx')), true)
})

test('the CLI supplies a reference for a lesson without a starter without creating its mod', async () => {
  const cliWorkspace = join(scratch, 'cli-no-starter')
  makeWorkspace(cliWorkspace)
  const lesson = loadLessons(join(REPO, 'learn')).find(one => one.starter === null)
  const checked = await checker([lesson.id, '--no-types'], { cwd: cliWorkspace })
  assert.match(checked.output, /Reference solution:/)
  assert.equal(existsSync(join(cliWorkspace, 'solutions', lesson.id, 'hooks')), true)
  assert.equal(existsSync(join(cliWorkspace, 'workshop', lesson.mod)), false)
})

test('checking an arbitrary directory does not copy a solution into the workspace', async () => {
  const cliWorkspace = join(scratch, 'cli-other-dir')
  makeWorkspace(cliWorkspace)
  const checked = await checker(['tick', '--no-types', '--dir', join(scratch, 'absent-mod')], { cwd: cliWorkspace })
  assert.doesNotMatch(checked.output, /Reference solution:/)
  assert.equal(existsSync(join(cliWorkspace, 'solutions')), false)
})

test('the checker refuses the home folder as its workspace, and says how to choose another', async () => {
  const refused = await checker([], { cwd: home, env: { HOME: home } })
  assert.equal(refused.code, 1)
  assert.match(refused.output, /cannot be your home folder .*set MOD_LAB_WORKSPACE to one/)
})

test('a standalone server does not select project or lesson destinations from cwd or MOD_LAB_WORKSPACE', async () => {
  const bridgeFile = join(scratch, 'bridge.json')
  const child = spawn(process.execPath, [join(REPO, 'web', 'server.mjs')], {
    cwd: workspace,
    // HOME is the scratch folder's, so nothing the main block defaults to reaches the real one.
    env: { ...withoutWorkspace({ HOME: home, MOD_LAB_PORT: '0', MOD_LAB_BRIDGE_FILE: bridgeFile }), MOD_LAB_WORKSPACE: workspace },
    stdio: 'ignore',
  })
  try {
    const deadline = Date.now() + 15_000
    while (!existsSync(bridgeFile)) {
      if (Date.now() > deadline) throw new Error('the server did not write its bridge file')
      await new Promise(done => setTimeout(done, 100))
    }
    const { url, token } = JSON.parse(readFileSync(bridgeFile, 'utf8'))
    const sandbox = await fetch(`${url}/api/sandbox`, { headers: { 'x-lab-token': token } }).then(res => res.json())
    assert.equal(sandbox.dir, null)
    assert.equal(sandbox.project, null)
    assert.equal(sandbox.lessonWorkspace, null)
    assert.ok(!existsSync(join(workspace, 'workshop', 'sandbox-mod')))
  } finally {
    child.kill()
  }
})

test("the reference is built from the declarations under <workspace>/.claude/skills/ when nothing before them in the lookup's order has any", async () => {
  const laid = join(workspace, '.claude', 'skills', 'laid-w2', '.claude-plugin', 'types', 'claude-code')
  mkdirSync(laid, { recursive: true })
  writeFileSync(join(laid, 'index.d.ts'), readFileSync(typesPath, 'utf8').replace('0.0.7', '0.0.8'))
  // MOD_LAB_TYPES comes first in the order, and the environment the tests run in may set it.
  const { MOD_LAB_TYPES } = process.env
  delete process.env.MOD_LAB_TYPES
  // Nor do the package's own mod-lab and mod-lab-bridge, where an interactive session from a clone lays them.
  const own = await startServer({ port: 0, workspace, pluginRoots: [] })
  try {
    const catalog = await fetch(`${own.url}/api/catalog`, { headers: { 'x-lab-token': own.token } }).then(res => res.json())
    assert.deepEqual([catalog.version, catalog.found], ['0.0.8', 'in .claude/skills/laid-w2'])
  } finally {
    if (MOD_LAB_TYPES !== undefined) process.env.MOD_LAB_TYPES = MOD_LAB_TYPES
    await own.close()
  }
})

test('the checker type-checks a workshop mod in the workspace and shows its paths from there', async () => {
  const checked = await checker([challenge.id], { cwd: workspace, env: { MOD_LAB_TYPES: typesPath } })
  assert.match(checked.output, /TypeScript: /)
  assert.doesNotMatch(checked.output, /skipped: no claude-code\.d\.ts found/)
  assert.equal(checked.output.includes(workspace), false)
})

test('the repository is untouched', () => {
  assert.equal(repositoryState(), atStart)
})
