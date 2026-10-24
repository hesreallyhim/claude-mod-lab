// `npm run pack-check [-- --out <folder>]`: packs the package from a clean
// checkout of HEAD and checks that the tarball works without a clone and
// without npx. It keeps the tarball it checked, which is the one to publish
// (`npm publish <tarball>`), and prints its path, size, file count, SHA-256
// and npm integrity; a tarball that fails a check is deleted.
//
// 1. HEAD is extracted with `git archive` into a temporary folder, so neither
//    uncommitted changes nor ignored files (the tsconfig.json files the engine
//    writes) can reach it, and packed there with `npm pack --ignore-scripts`.
// 2. The packed list and package.json are checked: no .claude-plugin/types/,
//    tsconfig.json, workshop/ or .claude/; nothing the files list keeps out;
//    the licence declared, with its file; no preinstall, install or
//    postinstall; no dependency but TypeScript at 6.0.3.
// 3. The tarball is installed in an empty folder with `npm install
//    --save-exact --ignore-scripts`, and `./node_modules/.bin/claude-mod-lab
//    --help` runs: the route without npx.
// 4. init-lessons explicitly creates a workspace, then the installed launcher
//    starts `claude-mod-lab run <folder> --new -p "/mod-lab explorer serve"`
//    in default permission mode (no model requests). The lab
//    loads from its copies under ~/.claude-mod-lab/plugins/<version>/; the
//    session's own explorer, in the bridge's MCP server, serves from the
//    installed package, which only MOD_LAB_PACKAGE_ROOT names to it; the
//    bridge connects, a probe from the page answers the workspace, and both
//    bundled authoring skills appear in the session's command list.
// 5. In that workspace, a lesson's solution is checked with `learn <id>
//    --once`, TypeScript step included. That step needs the engine's
//    declarations: MOD_LAB_TYPES, or a plugin-authoring copy under the temp
//    folder. Then `add scratch-mod` copies scratch-mod into the workspace's
//    .claude/skills/.
//
// Steps 4 and 5 run with HOME set to a temporary folder, so the copies go
// there. claude keeps CLAUDE_CONFIG_DIR when it is set, and otherwise uses
// that folder's .claude, a throwaway config. Needs git, claude on the PATH,
// and TypeScript from the npm cache or registry.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { AUTHORING_PLUGINS, labPlugins } from '../web/lib/session-folders.mjs'
import { isGeneratedDeclaration } from './distribution-policy.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TYPESCRIPT = '6.0.3'

/** What the packed list must not hold, each with what it would be. */
const KEPT_OUT = [
  { test: path => basename(path) === 'tsconfig.json', what: 'tsconfig.json' },
  { test: path => path.startsWith('workshop/'), what: 'workshop/' },
  { test: path => path.startsWith('.claude/') || path.includes('/.claude/'), what: '.claude/ folder' },
  { test: path => /^(bin|web|learn)\/test\//.test(path) || /^plugins\/[^/]+\/tests?\//.test(path), what: 'maintainer tests' },
  { test: path => path.startsWith('plugins/') && !AUTHORING_PLUGINS.some(name => path.startsWith(`plugins/${name}/`)), what: 'unbundled authoring plugins' },
  { test: path => /^web\/e2e[^/]*\.mjs$/.test(path), what: 'e2e script' },
  { test: path => path.startsWith('scripts/') && path !== 'scripts/tsc.mjs', what: "maintainer script (the package runs only scripts/tsc.mjs)" },
  // An installed bridge's npm dependency on this package, which a --plugin-dir copy never installs (scripts/bridge-deps.mjs).
  { test: path => /^mods\/[^/]+\/package(-lock)?\.json$/.test(path), what: "a plugin's own package.json or lockfile" },
]
/** What it must hold: the licence and the entry points each route starts from. */
const REQUIRED = [
  'LICENSE', 'compat.json', 'bin/claude-mod-lab.mjs', 'web/server.mjs', 'web/public/versions.js', 'learn/check.mjs', 'scripts/tsc.mjs',
  ...AUTHORING_PLUGINS.flatMap(name => [`plugins/${name}/.claude-plugin/plugin.json`, `plugins/${name}/skills/${name}/SKILL.md`]),
]

const failures = []
function expect(isTrue, message) {
  console.log(`${isTrue ? 'ok  ' : 'FAIL'} ${message}`)
  if (!isTrue) failures.push(message)
  return isTrue
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  return result
}

/** Runs a step that later ones need; stops the run with its output when it fails. */
function must(what, file, args, options) {
  const result = run(file, args, options)
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout
}

async function until(what, check, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 200))
  }
}

function checkPacked(files, manifest, source) {
  console.log('\n== the packed files and package.json')
  const generated = files.filter(path => isGeneratedDeclaration(
    path, path.endsWith('.d.ts') ? readFileSync(join(source, path), 'utf8') : '',
  ))
  expect(generated.length === 0, `no generated engine declarations in the tarball${generated.length > 0 ? `: ${generated.join(', ')}` : ''}`)
  for (const { test, what } of KEPT_OUT) {
    const found = files.filter(test)
    expect(found.length === 0, `no ${what} in the tarball${found.length > 0 ? `: ${found.slice(0, 5).join(', ')}` : ''}`)
  }
  for (const path of REQUIRED) expect(files.includes(path), `${path} is in it`)
  expect(manifest.license === 'MIT', `package.json declares the licence (${manifest.license})`)
  expect(manifest.private !== true, 'package.json is not private')
  const scripts = Object.keys(manifest.scripts ?? {}).filter(name => ['preinstall', 'install', 'postinstall'].includes(name))
  expect(scripts.length === 0, `no install script${scripts.length > 0 ? `: ${scripts.join(', ')}` : ''}`)
  const dependencies = JSON.stringify(manifest.dependencies ?? {})
  expect(dependencies === JSON.stringify({ typescript: TYPESCRIPT }), `the one dependency is typescript ${TYPESCRIPT} (${dependencies})`)
  const others = ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']
  expect(others.every(field => manifest[field] === undefined), `no ${others.join(', ')}`)
}

/** Steps 4 and 5 share this: HOME moved to the run's own folder, and none of the explorer's variables from outside. */
function environment(home) {
  const env = { ...process.env, HOME: home, NO_COLOR: '1', DISABLE_AUTOUPDATER: '1' }
  for (const name of ['MOD_LAB_WORKSPACE', 'MOD_LAB_LESSONS', 'MOD_LAB_PORT', 'MOD_LAB_BRIDGE_FILE', 'MOD_LAB_OPEN', 'MOD_LAB_NO_OPEN']) delete env[name]
  return env
}

async function checkLesson(bin, installed, workspace, env) {
  console.log('\n== a lesson checked from the installed package')
  const { loadLessons } = await import(pathToFileURL(join(installed, 'learn', 'lib', 'lessons.mjs')).href)
  const lesson = loadLessons(join(installed, 'learn')).find(one => existsSync(join(one.dir, 'solution')))
  cpSync(join(lesson.dir, 'solution'), join(workspace, 'workshop', lesson.mod), { recursive: true })
  const checked = run(bin, ['learn', lesson.id, '--once'], { cwd: workspace, env })
  const output = `${checked.stdout}${checked.stderr}`
  const passed = [
    expect(checked.status === 0, `learn ${lesson.id} --once passes on its solution in workshop/${lesson.mod}`),
    expect(/TypeScript: no errors/.test(output), 'its TypeScript step ran, with the hoisted compiler, and found no errors'),
    expect(existsSync(join(workspace, '.claude-mod-lab', 'progress.json')), "its progress went to the workspace's state"),
  ]
  if (/no claude-code\.d\.ts found/.test(output)) console.log('     no declarations were found: set MOD_LAB_TYPES to them')
  if (passed.includes(false)) console.log(output)
}

/** A port nothing listens on now. */
async function freePort() {
  const probe = createServer()
  await new Promise(done => probe.listen(0, '127.0.0.1', () => done()))
  const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address())
  await new Promise(done => probe.close(() => done()))
  return port
}

/** Verify the installed route loads skills, rather than only copying their files. */
async function checkAuthoringSkills(api, copies) {
  for (const name of AUTHORING_PLUGINS) {
    expect(existsSync(join(copies, name, '.claude-plugin', 'plugin.json')), `the launcher copied ${name}`)
    expect(existsSync(join(copies, name, 'skills', name, 'SKILL.md')), `the copied ${name} contains its skill`)
  }
  await api('/api/run', { probe: 'command.list', args: {} })
  const listed = await until(
    'the command list to come back',
    async () => (await api('/api/state')).runs.findLast(one => one.probe === 'command.list' && one.from === 'explorer'),
    20_000,
  )
  const names = listed.ok && Array.isArray(listed.value) ? listed.value.map(command => command.name) : []
  for (const name of AUTHORING_PLUGINS) {
    expect(names.includes(`/${name}:${name}`), `/${name}:${name} is available in the installed session`)
  }
}

async function checkSession(bin, workspace, home, env, version, lab) {
  console.log('\n== the installed launcher, headless, in a new folder')
  const port = await freePort()
  const output = []
  must('initialize lessons', bin, ['init-lessons', workspace], { cwd: home, env })
  const args = ['run', workspace, '--new', '-p', '--permission-mode', 'default', '/mod-lab explorer serve 60']
  const child = spawn(bin, args, { cwd: home, env: { ...env, MOD_LAB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => output.push(String(chunk)))
  child.stderr.on('data', chunk => output.push(String(chunk)))
  const done = new Promise(ended => child.on('exit', ended))
  const page = `http://localhost:${port}`
  try {
    const html = await until(
      "the session's explorer to serve",
      async () => {
        const answer = await fetch(page).catch(() => null)
        return answer?.status === 200 && answer.text()
      },
      60_000,
    )
    expect(existsSync(join(workspace, '.claude-mod-lab')), `the launcher made ${workspace} a workspace`)
    const token = /name="lab-token" content="([^"]+)"/.exec(html)?.[1]
    // The bridge's copy has no node_modules and no clone around it, so the server found the package through MOD_LAB_PACKAGE_ROOT.
    expect(token !== undefined, `the session's own explorer served the page at ${page}, from the installed package`)
    const api = async (path, body) => {
      const headers = { 'x-lab-token': token, 'content-type': 'application/json' }
      const init = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }
      return (await fetch(`${page}${path}`, init)).json()
    }
    const connected = await until(
      'the bridge to connect',
      async () => {
        const { session: seen } = await api('/api/state')
        return seen?.isConnected === true && seen
      },
      30_000,
    )
    expect(connected.facts?.cwd === workspace, `the session runs in the workspace (${connected.facts?.cwd})`)
    const copies = join(home, '.claude-mod-lab', 'plugins', version)
    expect(String(connected.plugin?.root).startsWith(`${copies}${sep}`), `the bridge loaded from its copy (${connected.plugin?.root})`)
    for (const name of lab) expect(existsSync(join(copies, name, '.claude-plugin', 'plugin.json')), `the launcher copied ${name} to ${join(copies, name)}`)
    await api('/api/run', { probe: 'session.cwd', args: {} })
    const answered = await until(
      'the probe to come back',
      async () => (await api('/api/state')).runs.findLast(one => one.probe === 'session.cwd' && one.from === 'explorer'),
      20_000,
    )
    expect(answered.ok === true && answered.value === workspace, 'session.cwd, run from the explorer, answered the workspace')
    await checkAuthoringSkills(api, copies)
  } catch (error) {
    expect(false, error.message)
    console.log(output.join(''))
  } finally {
    child.kill('SIGTERM')
    await done
  }
}

async function main() {
  const at = process.argv.indexOf('--out')
  const out = resolve(at === -1 ? join(tmpdir(), 'claude-mod-lab-pack') : (process.argv[at + 1] ?? '.'))
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-pack-check-')))
  const [source, install, home, workspace] = ['source', 'install', 'home', 'workspace'].map(name => join(temp, name))
  let tarball = null
  let packed = null
  try {
    console.log('== packing HEAD')
    const head = must('git rev-parse', 'git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).trim()
    if (must('git status', 'git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no']).trim() !== '') {
      console.log(`note: uncommitted changes are not in the tarball, which is packed from HEAD (${head})`)
    }
    // The workspace is left for the launcher to make.
    for (const dir of [source, install, home, out]) mkdirSync(dir, { recursive: true })
    must('git archive', 'git', ['-C', REPO, 'archive', '--format=tar', '-o', join(temp, 'head.tar'), 'HEAD'])
    must('tar', 'tar', ['-xf', join(temp, 'head.tar'), '-C', source])
    ;[packed] = JSON.parse(
      must('npm pack', 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: source }),
    )
    tarball = join(out, packed.filename)
    console.log(`packed ${head} into ${tarball}`)
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    checkPacked(packed.files.map(file => file.path), manifest, source)

    console.log('\n== installed with npm install --save-exact --ignore-scripts')
    writeFileSync(join(install, 'package.json'), '{ "name": "pack-check-install", "private": true }\n')
    must('npm install', 'npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', tarball], { cwd: install })
    const modules = readdirSync(join(install, 'node_modules')).filter(name => !name.startsWith('.')).sort()
    expect(JSON.stringify(modules) === JSON.stringify(['claude-mod-lab', 'typescript']), `node_modules holds the package and TypeScript alone (${modules.join(', ')})`)
    const bin = join(install, 'node_modules', '.bin', 'claude-mod-lab')
    const help = run(bin, ['--help'], { cwd: install })
    expect(help.status === 0 && help.stdout.startsWith('Usage: claude-mod-lab'), './node_modules/.bin/claude-mod-lab --help runs')

    const installed = join(install, 'node_modules', 'claude-mod-lab')
    const env = environment(home)
    await checkSession(bin, workspace, home, env, manifest.version, labPlugins(join(installed, 'mods')).names)
    await checkLesson(bin, installed, workspace, env)
    console.log('\n== add, from the installed package')
    const added = run(bin, ['add', 'scratch-mod'], { cwd: workspace, env })
    const copy = join(workspace, '.claude', 'skills', 'scratch-mod')
    expect(added.status === 0 && existsSync(join(copy, 'tests')), `add scratch-mod copied it to ${copy}`)
  } catch (error) {
    expect(false, error instanceof Error ? error.message : String(error))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    if (tarball !== null) rmSync(tarball, { force: true })
    console.log(`\n${failures.length} check(s) failed${tarball !== null ? '; the tarball was deleted' : ''}`)
    return 1
  }
  const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  console.log(`\nall checks passed. The tarball to publish (npm publish <tarball>):
  ${tarball}
  ${packed.size} bytes, ${packed.unpackedSize} unpacked, ${packed.entryCount} files
  sha256     ${sha256}
  integrity  ${packed.integrity}`)
  return 0
}

process.exitCode = await main()
