// The bin's commands as a person types them, run in temporary folders. Starting
// the lab runs a stand-in claude and npm, put first on the PATH, which record how
// they were run; `examples add` asks the real `claude plugin list` for an installed copy
// when claude is there, and says so when it is not. `npm run test:bin`.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../claude-mod-lab.mjs', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

// claude and npm as the launcher meets them: each run is recorded, and claude's
// plugin list answers, or refuses --plugin-dir as managed settings make it do.
const STAND_IN = `const { appendFileSync } = require('node:fs')
const [tool, ...args] = process.argv.slice(2)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('MOD_LAB_')))
appendFileSync(process.env.STAND_IN_CALLS, JSON.stringify({ tool, args, cwd: process.cwd(), env }) + '\\n')
if (tool === 'npm') process.exit(Number(process.env.STAND_IN_NPM_STATUS || 0))
if (args.includes('plugin') && args.includes('list')) {
  if (process.env.STAND_IN_SIDELOAD === 'forbidden' && args.includes('--plugin-dir')) {
    process.stderr.write("--plugin-dir is disabled by your organization's managed settings (disableSideloadFlags).\\n")
    process.exit(1)
  }
  process.stdout.write('[]')
}
`

/** Runs the bin in `cwd` with extra environment; answers its status and output. */
function bin(args, { cwd = process.cwd(), env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, MOD_LAB_WORKSPACE: '', MOD_LAB_LESSONS: '', MOD_LAB_OPEN: '', MOD_LAB_NO_OPEN: '', MOD_LAB_BRIDGE_FILE: '', BROWSER: 'true', ...env },
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

/** Runs `fn` in a fresh temporary folder, removed after it, or after it settles when it answers a promise. */
function inTemp(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-cli-')))
  const clean = () => rmSync(dir, { recursive: true, force: true })
  let result
  try {
    result = fn(dir)
  } catch (error) {
    clean()
    throw error
  }
  if (result instanceof Promise) return result.finally(clean)
  clean()
  return result
}

/**
 * The stand-ins in `dir`/tools. Answers `lab`, which runs the bin with them
 * first on the PATH, and `calls`, what they were asked so far: `sessions`
 * are claude's runs that would have started a session.
 */
function standIns(dir) {
  const tools = join(dir, 'tools')
  const home = join(dir, 'home')
  mkdirSync(tools)
  mkdirSync(home)
  writeFileSync(join(tools, 'stand-in.cjs'), STAND_IN)
  for (const tool of ['claude', 'npm']) {
    writeFileSync(join(tools, tool), `#!/bin/sh\nexec "${process.execPath}" "${tools}/stand-in.cjs" ${tool} "$@"\n`)
    chmodSync(join(tools, tool), 0o755)
  }
  const log = join(dir, 'calls.jsonl')
  const lab = (args, { cwd = dir, env = {} } = {}) =>
    bin(args, { cwd, env: { PATH: `${tools}:${process.env.PATH}`, STAND_IN_CALLS: log, HOME: home, ...env } })
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
  const sessions = () => calls().filter(call => call.tool === 'claude' && !call.args.includes('plugin'))
  return { lab, calls, sessions }
}

/** The folders a session was given with --plugin-dir, in order. */
const pluginDirs = args => args.flatMap((arg, i) => (arg === '--plugin-dir' ? [args[i + 1]] : []))

test('--help describes separate explorer, session and lesson commands', () => {
  const help = bin(['--help'])
  assert.equal(help.status, 0)
  for (const command of ['run [project]', 'init-lessons <dir>', '--pin', 'learn [lesson]', 'examples list', 'examples add <name>']) {
    assert.ok(help.out.includes(command), `the help names ${command}`)
  }
  assert.equal(bin(['run', '--help']).out, help.out)
  assert.deepEqual(bin(['--version']), { status: 0, out: `${version}\n`, err: '' })
  assert.equal(bin(['learn', '--once']).status, 2)
})

test('init-lessons scaffolds explicitly without starting Claude, and run loads its workshop', () =>
  inTemp(dir => {
    const { lab, calls, sessions } = standIns(dir)
    const initialized = lab(['init-lessons', 'my-lab'])
    assert.equal(initialized.status, 0, initialized.err)
    assert.deepEqual(calls(), [], 'initializing needs neither Claude nor npm')
    const workspace = join(dir, 'my-lab')
    for (const folder of ['.claude-mod-lab', 'workshop']) assert.ok(existsSync(join(workspace, folder)), `${folder} made`)
    for (const file of ['README.md', '.gitignore']) assert.ok(existsSync(join(workspace, file)), `${file} written`)
    const started = lab(['run', 'my-lab', '--model', 'haiku'])
    assert.equal(started.status, 0, started.err)
    const [session] = sessions()
    assert.equal(session.cwd, workspace)
    const folders = pluginDirs(session.args)
    assert.deepEqual(folders.slice(0, 3), ['mod-lab', 'mod-lab-bridge', 'mod-lab-target'].map(name => join(PACKAGE_ROOT, 'mods', name)))
    assert.ok(folders.includes(join(PACKAGE_ROOT, 'plugins', 'mod-bootstrap')), 'mod-bootstrap is loaded without a marketplace install')
    const collection = session.env.MOD_LAB_LESSON_COLLECTION
    const examples = join(dir, 'home', '.claude-mod-lab', 'examples')
    assert.ok(collection.startsWith(join(dir, 'home', '.claude-mod-lab', 'projects')))
    assert.ok(folders.includes(collection))
    assert.ok(!folders.includes(join(workspace, 'workshop')))
    assert.deepEqual(JSON.parse(session.env.MOD_LAB_COMPONENT_DIRS), [examples, collection])
    assert.deepEqual(session.args.slice(-2), ['--model', 'haiku'])
    assert.equal(session.env.MOD_LAB_NODE, process.execPath)
    assert.equal(session.env.MOD_LAB_PACKAGE_ROOT, PACKAGE_ROOT)
    assert.equal(session.env.MOD_LAB_LESSONS, workspace)
    assert.equal(session.env.MOD_LAB_OPEN, '1')
  }))

test('run shares examples across projects without writing project files or loading unrelated workshops', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const project = join(dir, 'project')
    mkdirSync(join(project, 'workshop'), { recursive: true })
    writeFileSync(join(project, 'README.md'), 'Their project.\n')
    const result = lab(['run'], { cwd: project, env: { MOD_LAB_WORKSPACE: '/old/lesson/path', MOD_LAB_LESSON_COLLECTION: '/old/lesson/collection', MOD_LAB_COMPONENT_DIRS: '["/old/components"]' } })
    assert.equal(result.status, 0, result.err)
    assert.deepEqual(readdirSync(project).sort(), ['README.md', 'workshop'])
    const collection = join(dir, 'home', '.claude-mod-lab', 'examples')
    assert.deepEqual(readdirSync(collection), [])
    assert.ok(pluginDirs(sessions()[0].args).includes(collection))
    assert.deepEqual(JSON.parse(sessions()[0].env.MOD_LAB_COMPONENT_DIRS), [collection, sessions()[0].env.MOD_LAB_LESSON_COLLECTION])
    assert.equal(sessions()[0].env.MOD_LAB_EXAMPLES_DIR, collection)
    assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), 'Their project.\n')
    assert.ok(!pluginDirs(sessions()[0].args).some(path => path.endsWith('/workshop')))
    assert.equal(sessions()[0].env.MOD_LAB_LESSONS, '')
    assert.ok(sessions()[0].env.MOD_LAB_LESSON_COLLECTION.startsWith(join(dir, 'home', '.claude-mod-lab', 'projects')))
    assert.equal(sessions()[0].env.MOD_LAB_WORKSPACE, '')
    const second = join(dir, 'second-project')
    mkdirSync(second)
    assert.equal(lab(['run'], { cwd: second }).status, 0)
    assert.equal(sessions()[1].env.MOD_LAB_EXAMPLES_DIR, collection)
    assert.notEqual(sessions()[1].env.MOD_LAB_LESSON_COLLECTION, sessions()[0].env.MOD_LAB_LESSON_COLLECTION)
    assert.deepEqual(readdirSync(second), [])
    assert.equal(sessions()[1].env.MOD_LAB_LESSONS, '')
    assert.ok(!pluginDirs(sessions()[1].args).some(path => path.endsWith('/workshop')))
  }))

test('run --local explicitly loads known legacy component copies in place, skipping unrelated and duplicate copies', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const project = join(dir, 'project')
    const legacy = join(project, '.claude', 'skills')
    const collection = join(project, '.claude', 'mod-lab')
    const plugin = (root, name, manifestName = name) => {
      const at = join(root, name)
      mkdirSync(join(at, '.claude-plugin'), { recursive: true })
      writeFileSync(join(at, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: manifestName }))
      writeFileSync(join(at, 'mine.txt'), 'My edited copy.\n')
      return at
    }
    const gallery = plugin(legacy, 'gallery-mod')
    const raster = plugin(legacy, 'raster-mod')
    const unrelated = plugin(legacy, 'unrelated-mod')
    const foreign = plugin(legacy, 'band-mod', 'different-plugin')
    const duplicate = plugin(legacy, 'hover-mod')
    plugin(collection, 'hover-mod')
    const result = lab(['run', project, '--local'])
    assert.equal(result.status, 0, result.err)
    const folders = pluginDirs(sessions()[0].args)
    for (const included of [collection, gallery, raster]) assert.ok(folders.includes(included), included)
    for (const skipped of [unrelated, foreign, duplicate]) assert.ok(!folders.includes(skipped), skipped)
    assert.deepEqual(JSON.parse(sessions()[0].env.MOD_LAB_COMPONENT_DIRS), [collection, raster, gallery])
    assert.equal(sessions()[0].env.MOD_LAB_EXAMPLES_DIR, collection)
    const shared = lab(['run', project])
    assert.equal(shared.status, 0, shared.err)
    for (const local of [collection, gallery, raster]) assert.ok(!pluginDirs(sessions()[1].args).includes(local), local)
    assert.equal(readFileSync(join(gallery, 'mine.txt'), 'utf8'), 'My edited copy.\n')
    assert.ok(!existsSync(join(collection, 'gallery-mod')), 'legacy copies are not moved or duplicated')
  }))

test('run forwards Claude arguments after -- and headless sessions do not open an explorer', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const result = lab(['run', '--', '-p', '/mod-lab explorer', '--model', 'haiku', '--local'])
    assert.equal(result.status, 0, result.err)
    assert.equal(sessions()[0].env.MOD_LAB_OPEN, '')
    assert.deepEqual(sessions()[0].args.slice(-5), ['-p', '/mod-lab explorer', '--model', 'haiku', '--local'])
    assert.equal(lab(['run', '--no-open']).status, 0)
    assert.equal(sessions()[1].env.MOD_LAB_OPEN, '1', 'the explorer still starts')
    assert.equal(sessions()[1].env.MOD_LAB_NO_OPEN, '1', 'only the browser opening is suppressed')
  }))

test('a home directory with application state is not mistaken for a lesson workspace', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const home = join(dir, 'home')
    mkdirSync(join(home, '.claude-mod-lab'))
    const result = lab(['run'], { cwd: home })
    assert.equal(result.status, 0, result.err)
    assert.equal(sessions()[0].env.MOD_LAB_LESSONS, '')
    assert.equal(sessions()[0].env.MOD_LAB_LESSON_COLLECTION, '')
    assert.deepEqual(JSON.parse(sessions()[0].env.MOD_LAB_COMPONENT_DIRS), [join(home, '.claude-mod-lab', 'examples')])
    assert.ok(!existsSync(join(home, '.claude', 'mod-lab')))
    assert.ok(!pluginDirs(sessions()[0].args).some(path => path.endsWith('/workshop')))
    assert.ok(!existsSync(join(home, 'workshop')))
  }))

test("the lesson .gitignore keeps state and generated declarations out of git, and keeps authored mods", () =>
  inTemp(dir => {
    const { lab } = standIns(dir)
    assert.equal(lab(['init-lessons', 'my-lab']).status, 0)
    const workspace = join(dir, 'my-lab')
    spawnSync('git', ['init', '-q', workspace])
    const isIgnored = path => spawnSync('git', ['-C', workspace, 'check-ignore', '-q', path]).status === 0
    assert.ok(isIgnored('.claude-mod-lab/progress.json'))
    assert.ok(isIgnored('.claude/settings.local.json'))
    assert.ok(isIgnored('workshop/stopwatch/.claude-plugin/types/claude-code/index.d.ts'))
    assert.ok(!isIgnored('workshop/stopwatch/hooks/register.ts'))
    assert.ok(!isIgnored('workshop/stopwatch/.claude-plugin/plugin.json'))
  }))

test('initialization accepts an empty directory or existing lesson workspace without overwriting its files', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const workspace = join(dir, 'here')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    assert.equal(lab(['init-lessons', '.'], { cwd: workspace }).status, 0)
    writeFileSync(join(workspace, 'README.md'), 'mine\n')
    assert.equal(lab(['init-lessons', '.'], { cwd: workspace }).status, 0)
    assert.equal(readFileSync(join(workspace, 'README.md'), 'utf8'), 'mine\n')
    assert.deepEqual(sessions(), [])
  }))

test('only initialization refuses populated unrelated directories and HOME; implicit bootstrap gives migration guidance', () =>
  inTemp(dir => {
    const { lab, calls } = standIns(dir)
    const theirs = join(dir, 'theirs')
    mkdirSync(theirs)
    writeFileSync(join(theirs, 'notes.txt'), '')
    const refused = lab(['init-lessons', 'theirs'])
    assert.equal(refused.status, 1)
    assert.ok(!existsSync(join(theirs, '.claude-mod-lab')))
    const atHome = lab(['init-lessons', '.'], { cwd: join(dir, 'home') })
    assert.equal(atHome.status, 1)
    assert.match(atHome.err, /^The workspace cannot be your home folder/)
    assert.equal(lab(['init-lessons']).status, 2)
    const old = lab(['new-lab'])
    assert.equal(old.status, 2)
    assert.match(old.err, /init-lessons/)
    assert.ok(!existsSync(join(dir, 'new-lab')))
    assert.deepEqual(calls(), [])
  }))

test('init-lessons --pin installs an exact version without install scripts and never starts a session', () =>
  inTemp(dir => {
    const { lab, calls, sessions } = standIns(dir)
    assert.equal(lab(['init-lessons', 'my-lab', '--pin']).status, 0)
    const workspace = join(dir, 'my-lab')
    assert.equal(JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')).private, true)
    const npm = calls().find(call => call.tool === 'npm')
    assert.equal(npm.cwd, workspace)
    for (const arg of ['install', '--save-exact', '--ignore-scripts', `claude-mod-lab@${version}`]) assert.ok(npm.args.includes(arg))
    assert.equal(lab(['init-lessons', '--pin', 'other'], { env: { STAND_IN_NPM_STATUS: '3' } }).status, 3)
    assert.equal(lab(['run', '--pin']).status, 2)
    assert.deepEqual(sessions(), [])
  }))

test('run reports managed sideload restrictions before loading plugins or creating project files', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const project = join(dir, 'project')
    mkdirSync(project)
    const refused = lab(['run', 'project'], { env: { STAND_IN_SIDELOAD: 'forbidden' } })
    assert.equal(refused.status, 1)
    assert.match(refused.err, /disableSideloadFlags/)
    assert.match(refused.err, /claude plugin marketplace add hesreallyhim\/claude-mod-lab/)
    assert.deepEqual(readdirSync(project), [])
    assert.deepEqual(sessions(), [])
    assert.equal(lab(['run', 'missing']).status, 2)
    assert.ok(!existsSync(join(dir, 'missing')))
  }))

test('examples shows focused help and rejects incomplete or invalid commands', () =>
  inTemp(dir => {
    const help = bin(['examples'], { cwd: dir })
    assert.equal(help.status, 0, help.err)
    assert.match(help.out, /Usage: claude-mod-lab examples list/)
    assert.equal(bin(['examples', '--help'], { cwd: dir }).out, help.out)
    assert.equal(bin(['examples', 'add', '--help'], { cwd: dir }).out, help.out)
    for (const args of [
      ['add'],
      ['add', '--to', 'mine'],
      ['add', 'band-mod', '--to'],
      ['add', 'band-mod', '--unknown'],
      ['add', 'band-mod', '--local', '--to', 'mine'],
      ['list', 'band-mod'],
      ['unknown'],
    ]) {
      const result = bin(['examples', ...args], { cwd: dir })
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.err}`)
      assert.match(result.err, /examples|--to needs a folder/)
    }
    assert.deepEqual(readdirSync(dir), [], 'help and invalid commands do not copy files')
  }))

test('examples add shares editable copies across projects and works from HOME', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const home = join(dir, 'home')
    const shared = join(home, '.claude-mod-lab', 'examples')
    const first = join(dir, 'first')
    const second = join(dir, 'second')
    mkdirSync(first)
    mkdirSync(second)
    const added = lab(['examples', 'add', 'band-mod'], { cwd: first })
    assert.equal(added.status, 0, added.err)
    assert.match(added.out, /shared copy is available across projects/)
    assert.match(added.out, /Activate the example with its \/command in each session/)
    assert.ok(existsSync(join(shared, 'band-mod', '.claude-plugin', 'plugin.json')))
    assert.deepEqual(readdirSync(first), [])
    const again = lab(['examples', 'add', 'band-mod'], { cwd: second })
    assert.equal(again.status, 1)
    assert.match(again.err, /already there/)
    assert.equal(lab(['run'], { cwd: second }).status, 0)
    assert.equal(sessions()[0].env.MOD_LAB_EXAMPLES_DIR, shared)
    assert.deepEqual(readdirSync(second), [])
    assert.equal(lab(['examples', 'add', 'brackets-mod'], { cwd: home }).status, 0)
    assert.ok(existsSync(join(shared, 'brackets-mod', '.claude-plugin', 'plugin.json')))
    assert.equal(lab(['run', '--local'], { cwd: home }).status, 2)
  }))

test('examples add --local copies an example into the project collection loaded by run, then refuses to copy over it', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const listed = bin(['examples', 'list'], { cwd: dir })
    assert.equal(listed.status, 0)
    const { description } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'examples', 'brackets-mod', '.claude-plugin', 'plugin.json'), 'utf8'))
    const entry = listed.out.split('\n').find(line => /^\s+brackets-mod\s{2,}/.test(line))
    assert.equal(entry?.replace(/^\s+brackets-mod\s+/, ''), description)
    assert.match(listed.out, /Starter mod:\n\n  scratch-mod {2,}/)
    const added = lab(['examples', 'add', 'brackets-mod', '--local'])
    assert.equal(added.status, 0, added.err)
    assert.match(added.out, /Copied brackets-mod to \.claude\/mod-lab\/brackets-mod\//)
    assert.match(added.out, /claude-mod-lab run/)
    const collection = join(dir, '.claude', 'mod-lab')
    assert.ok(existsSync(join(collection, 'brackets-mod', '.claude-plugin', 'plugin.json')))
    const started = lab(['run', '--local'])
    assert.equal(started.status, 0, started.err)
    assert.ok(pluginDirs(sessions()[0].args).includes(collection))
    const again = lab(['examples', 'add', 'brackets-mod', '--local'])
    assert.equal(again.status, 1)
    assert.match(again.err, /already there, so nothing was copied/)
    assert.equal(bin(['examples', 'add', 'no-such-example'], { cwd: dir }).status, 1)
  }))

test('examples add --to copies scratch-mod where it is told, and MOD_LAB_WORKSPACE selects the --local project', () =>
  inTemp(dir => {
    const to = bin(['examples', 'add', 'scratch-mod', '--to', 'mine/scratch'], { cwd: dir })
    assert.equal(to.status, 0, to.err)
    assert.ok(existsSync(join(dir, 'mine', 'scratch', 'tests')))
    mkdirSync(join(dir, 'elsewhere'))
    const moved = bin(['examples', 'add', 'band-mod', '--local'], { cwd: dir, env: { MOD_LAB_WORKSPACE: 'elsewhere', HOME: join(dir, 'home') } })
    assert.equal(moved.status, 0, moved.err)
    assert.ok(existsSync(join(dir, 'elsewhere', '.claude', 'mod-lab', 'band-mod')))
  }))

test('examples add preserves an existing legacy copy instead of shadowing it with a new example', () =>
  inTemp(dir => {
    const legacy = join(dir, '.claude', 'skills', 'band-mod')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'mine.txt'), 'My edited copy.\n')
    const result = bin(['examples', 'add', 'band-mod', '--local'], { cwd: dir, env: { HOME: join(dir, 'home') } })
    assert.equal(result.status, 1)
    assert.match(result.err, /Keep your existing copy, move it to \.claude\/mod-lab\/band-mod\//)
    assert.equal(readFileSync(join(legacy, 'mine.txt'), 'utf8'), 'My edited copy.\n')
    assert.ok(!existsSync(join(dir, '.claude', 'mod-lab', 'band-mod')))
  }))

test('examples add --local refuses the home folder as a workspace, with the reason alone', () =>
  inTemp(dir => {
    const refused = bin(['examples', 'add', 'band-mod', '--local'], { cwd: dir, env: { HOME: dir } })
    assert.equal(refused.status, 1)
    assert.match(refused.err, /^The workspace cannot be your home folder/)
    assert.ok(!refused.err.includes('    at '), 'no stack trace')
    assert.ok(!existsSync(join(dir, '.claude')))
  }))

test('run and attach start their own explorer when the discovery file is missing or stale', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    assert.equal(lab(['run'], { env: { MOD_LAB_BRIDGE_FILE: join(dir, 'none.json') } }).status, 0)
    writeFileSync(join(dir, 'stale.json'), JSON.stringify({ url: 'http://127.0.0.1:1', token: 't' }))
    assert.equal(lab(['attach'], { env: { MOD_LAB_BRIDGE_FILE: join(dir, 'stale.json') } }).status, 0)
    writeFileSync(join(dir, 'invalid.json'), 'null')
    assert.equal(lab(['run'], { env: { MOD_LAB_BRIDGE_FILE: join(dir, 'invalid.json') } }).status, 0)
    for (const session of sessions()) {
      assert.equal(session.env.MOD_LAB_OPEN, '1')
      assert.equal(session.env.MOD_LAB_BRIDGE_FILE, '', 'a stale override does not block the session server')
    }
  }))

/** A verified stand-in explorer in its own process, since the launcher runs synchronously. */
async function stubExplorer({ session = null, protocol = 1 } = {}) {
  const child = spawn(process.execPath, ['-e', `
    const state = ${JSON.stringify({ runs: [], session })}
    require('node:http').createServer((req, res) => {
      if (req.headers['x-lab-token'] !== 't') { res.writeHead(401); return res.end() }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(req.url === '/api/context' ? { protocol: ${protocol} } : state))
    }).listen(0, '127.0.0.1', function () { process.stdout.write(String(this.address().port)) })
  `], {
    // Keep color enabled to catch accidental formatting of the port protocol.
    env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: undefined },
  })
  const port = await new Promise(resolve => child.stdout.once('data', chunk => resolve(Number(String(chunk).trim()))))
  return { port, stop: () => child.kill() }
}

test('run reuses an idle explorer, --new selects a session-owned explorer, and attach remains an alias', async () => {
  const server = await stubExplorer()
  try {
    await inTemp(dir => {
      const { lab, sessions } = standIns(dir)
      const file = join(dir, 'bridge.json')
      writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: 't' }))
      const env = { MOD_LAB_BRIDGE_FILE: file }
      for (const command of ['run', 'attach']) {
        const result = lab([command, '--no-open', '--model', 'haiku'], { env })
        assert.equal(result.status, 0, result.err)
      }
      for (const session of sessions()) {
        assert.equal(session.env.MOD_LAB_BRIDGE_FILE, file)
        assert.equal(session.env.MOD_LAB_OPEN, '')
        assert.deepEqual(session.args.slice(-2), ['--model', 'haiku'])
      }
      assert.equal(lab(['run', '--new'], { env }).status, 0)
      assert.equal(sessions()[2].env.MOD_LAB_BRIDGE_FILE, '')
      assert.equal(sessions()[2].env.MOD_LAB_OPEN, '1')
    })
  } finally { server.stop() }
})

test('an occupied or incompatible explorer is identified and a new session gets its own explorer', async () => {
  for (const fixture of [{ session: { isConnected: true, facts: { cwd: '/another-project' } } }, { protocol: 999 }]) {
    const server = await stubExplorer(fixture)
    try {
      await inTemp(dir => {
        const { lab, sessions } = standIns(dir)
        const file = join(dir, 'bridge.json')
        writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: 't' }))
        const result = lab(['run'], { env: { MOD_LAB_BRIDGE_FILE: file } })
        assert.equal(result.status, 0, result.err)
        assert.match(result.err, /separate explorer/)
        assert.equal(sessions()[0].env.MOD_LAB_OPEN, '1')
        assert.equal(sessions()[0].env.MOD_LAB_BRIDGE_FILE, '')
      })
    } finally { server.stop() }
  }
})

test('opening an existing explorer succeeds without starting Claude or changing its discovery file', async () => {
  const server = await stubExplorer()
  try {
    await inTemp(dir => {
      const { lab, calls } = standIns(dir)
      const file = join(dir, 'bridge.json')
      const record = JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: 't' })
      writeFileSync(file, record)
      for (const args of [['--no-open'], ['serve', '--no-open']]) {
        const result = lab(args, { env: { MOD_LAB_BRIDGE_FILE: file } })
        assert.equal(result.status, 0, result.err)
        assert.match(result.out, /already running/)
      }
      assert.equal(readFileSync(file, 'utf8'), record)
      assert.deepEqual(calls(), [])
    })
  } finally { server.stop() }
})

async function serveUntilStopped(dir, args, extraEnv = {}) {
  const file = join(dir, 'bridge.json')
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: dir,
    env: { ...process.env, MOD_LAB_WORKSPACE: '', MOD_LAB_LESSONS: '', MOD_LAB_BRIDGE_FILE: file, MOD_LAB_PORT: '0', ...extraEnv },
  })
  let out = ''
  let err = ''
  child.stderr.on('data', chunk => (err += chunk))
  let timer
  const said = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      out += chunk
      if (out.includes('npx claude-mod-lab run')) resolve()
    })
    timer = setTimeout(() => reject(new Error(`explorer said: ${out}; stderr: ${err}`)), 20_000)
    child.once('exit', () => reject(new Error(`explorer stopped: ${out}; stderr: ${err}`)))
  })
  const ended = new Promise(resolve => child.once('exit', resolve))
  try {
    await said
    clearTimeout(timer)
    assert.match(out, /mod-lab explorer: http:\/\/localhost:\d+/)
    const { url, token } = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal((await fetch(`${url}/`)).status, 200)
    const context = await fetch(`${url}/api/context`, { headers: { 'X-Lab-Token': token } })
    assert.deepEqual(await context.json(), { project: null, lessonWorkspace: null, protocol: 1 })
    const reopened = bin(['--no-open'], { cwd: dir, env: { MOD_LAB_BRIDGE_FILE: file } })
    assert.equal(reopened.status, 0, reopened.err)
    assert.match(reopened.out, /already running/)
  } finally {
    clearTimeout(timer)
    child.kill('SIGINT')
    await ended
  }
  assert.ok(!existsSync(file))
}

test('the default opens an explorer in a populated directory without scaffolding it', async () =>
  inTemp(async dir => {
    writeFileSync(join(dir, 'README.md'), 'existing project')
    await serveUntilStopped(dir, ['--no-open'])
    assert.deepEqual(readdirSync(dir), ['README.md'])
  }))

test('the default opens from HOME, and explicit ports select separate discovery files', async () =>
  inTemp(async dir => {
    await serveUntilStopped(dir, ['--no-open'], { HOME: dir })
    const server = await stubExplorer()
    try {
      const { lab, sessions } = standIns(dir)
      const home = join(dir, 'home')
      const endpoint = join(home, '.claude-mod-lab', 'explorers', `${server.port}.json`)
      mkdirSync(join(home, '.claude-mod-lab', 'explorers'), { recursive: true })
      writeFileSync(endpoint, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: 't' }))
      const result = lab(['run', '--port', String(server.port), '--no-open'])
      assert.equal(result.status, 0, result.err)
      assert.equal(sessions()[0].env.MOD_LAB_BRIDGE_FILE, endpoint)
      for (const port of ['bad', '-1', '65536']) assert.equal(lab(['serve', '--port', port]).status, 2)
    } finally { server.stop() }
  }))


test('run reuses lesson links without loading the same workshop plugins twice', () =>
  inTemp(dir => {
    const { lab, sessions } = standIns(dir)
    const project = join(dir, 'linked-lessons')
    const collection = join(project, '.claude', 'mod-lab')
    mkdirSync(collection, { recursive: true })
    mkdirSync(join(project, '.claude-mod-lab'))
    for (const name of ['tick', 'another']) {
      const manifest = join(project, 'workshop', name, '.claude-plugin')
      mkdirSync(manifest, { recursive: true })
      writeFileSync(join(manifest, 'plugin.json'), JSON.stringify({ name, version: '0.1.0' }))
    }
    symlinkSync('../../workshop/tick', join(collection, 'tick'), 'dir')
    const started = lab(['run', project])
    assert.equal(started.status, 0, started.err)
    const [session] = sessions()
    const folders = pluginDirs(session.args)
    const lessonCollection = session.env.MOD_LAB_LESSON_COLLECTION
    assert.equal(folders.filter(path => path === lessonCollection).length, 1)
    assert.ok(!folders.includes(collection))
    assert.equal(folders.includes(join(project, 'workshop')), false)
    assert.ok(lessonCollection.startsWith(join(dir, 'home', '.claude-mod-lab', 'projects')))
    assert.equal(session.env.MOD_LAB_LESSONS, project)
    assert.equal(realpathSync(join(lessonCollection, 'another')), join(project, 'workshop', 'another'))
    const local = lab(['run', project, '--local'])
    assert.equal(local.status, 0, local.err)
    const localFolders = pluginDirs(sessions()[1].args)
    assert.equal(localFolders.filter(path => path === collection).length, 1)
    assert.ok(!localFolders.includes(lessonCollection))
    assert.ok(!localFolders.includes(join(project, 'workshop')))
    assert.equal(sessions()[1].env.MOD_LAB_LESSON_COLLECTION, collection)
    assert.equal(realpathSync(join(collection, 'another')), join(project, 'workshop', 'another'))
  }))
