// temp: checks the installed route before anything is published: that a mod-lab-bridge installed
// from a git marketplace brings the claude-mod-lab package, and that its session serves the explorer
// from it. Written while building that route (October 2026), from the steps first run by hand;
// kept as the check to run before a release, since the route cannot otherwise be tried until the
// package is on npm. Node 22, git, npm and claude on the PATH; nothing outside a temp folder changes
// but npm's cache.
//
//   node scripts/install-check.temp.mjs [--keep]
//
// 1. packs HEAD (git archive, npm pack --ignore-scripts), as pack-check does;
// 2. serves that tarball from a local npm registry on 127.0.0.1, every other package's
//    metadata coming from npmjs.org, so the package counts as published;
// 3. clones HEAD and runs `npm run bridge-lock` in the clone against that registry, which writes
//    the bridge's lockfile, commits it and tags the bridge there;
// 4. serves the clone over git's smart HTTP protocol, adds it as a marketplace in a throwaway
//    Claude Code config, and installs mod-lab-bridge, with npm's registry set to the local one
//    (Claude Code installs only registry packages, and refuses an http link on another host);
// 5. checks the bridge's copy holds node_modules/claude-mod-lab and typescript;
// 6. starts `claude -p "/mod-lab explorer serve"` there and checks the page is served from the
//    installed package, the bridge connects, and a probe run from the page answers.
//
// --keep leaves the temp folder for a look afterwards.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'install-check-')))
const [pack, clone, config, work] = ['pack', 'clone', 'config', 'work'].map(name => join(temp, name))
const failures = []
const expect = (isTrue, message) => {
  console.log(`${isTrue ? 'ok  ' : 'FAIL'} ${message}`)
  if (!isTrue) failures.push(message)
}
const must = (what, file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout
}
/**
 * Runs a command without blocking: the registry and the git server answer from this process, so a
 * command that reaches them must not hold its event loop, as spawnSync would.
 */
function runAsync(file, args, options = {}) {
  return new Promise(done => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', error => done({ status: 1, stdout, stderr: String(error) }))
    child.on('close', status => done({ status, stdout, stderr }))
  })
}

async function mustAsync(what, file, args, options) {
  const result = await runAsync(file, args, options)
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout
}

const listen = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(server.address().port)))

/** A port nothing listens on now. */
async function freePort() {
  const probe = createServer()
  const port = await listen(probe)
  await new Promise(done => probe.close(() => done()))
  return port
}

/** A registry with the packed package as if published; everything else from npmjs.org. */
function registry(tarball) {
  const bytes = readFileSync(tarball)
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  const path = `/${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`
  let base = ''
  const server = createServer(async (req, res) => {
    const at = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (at === `/${manifest.name}`) {
      const dist = {
        tarball: `${base}${path}`,
        shasum: createHash('sha1').update(bytes).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      }
      const version = { ...manifest, _id: `${manifest.name}@${manifest.version}`, dist }
      const body = { name: manifest.name, 'dist-tags': { latest: manifest.version }, versions: { [manifest.version]: version } }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    if (at === path) return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(bytes)
    const upstream = await fetch(`https://registry.npmjs.org${req.url}`, { headers: { accept: req.headers.accept ?? 'application/json' } })
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    res.end(Buffer.from(await upstream.arrayBuffer()))
  })
  return { server, setBase: url => (base = url) }
}

/** git's smart HTTP protocol over `root`, which Claude Code's shallow clone of a marketplace needs. */
function gitServer(root) {
  const backend = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git-http-backend')
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const cgi = spawn(backend, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(url.pathname),
        REQUEST_METHOD: req.method,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
      },
    })
    req.pipe(cgi.stdin)
    let head = Buffer.alloc(0)
    let isSent = false
    cgi.stdout.on('data', chunk => {
      if (isSent) return void res.write(chunk)
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end === -1) return
      let status = 200
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const [name, ...rest] = line.split(':')
        if (name.toLowerCase() === 'status') status = parseInt(rest.join(':'), 10)
        else res.setHeader(name, rest.join(':').trim())
      }
      res.writeHead(status)
      isSent = true
      res.write(head.subarray(end + 4))
    })
    cgi.stdout.on('end', () => res.end())
  })
}

/** The environment of a person's own Claude Code: none of a parent session's variables, a throwaway config. */
function personEnv(registryUrl) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CLAUDE|ANTHROPIC|MCP_)/.test(name)))
  return { ...env, CLAUDE_CONFIG_DIR: config, BROWSER: 'true', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', npm_config_registry: registryUrl }
}

async function main() {
  console.log('== packing HEAD')
  for (const dir of [pack, config, work]) mkdirSync(dir, { recursive: true })
  const source = join(temp, 'source')
  mkdirSync(source)
  execFileSync('sh', ['-c', `git -C "${REPO}" archive --format=tar HEAD | tar -x -C "${source}"`])
  must('npm pack', 'npm', ['pack', '--ignore-scripts', '--pack-destination', pack], { cwd: source })
  const tarball = join(pack, readdirSync(pack)[0])
  const { server: npm, setBase } = registry(tarball)
  const registryUrl = `http://127.0.0.1:${await listen(npm)}`
  setBase(registryUrl)
  const git = gitServer(temp)
  const gitUrl = `http://127.0.0.1:${await listen(git)}/marketplace.git`
  try {
    console.log(`\n== bridge-lock in a clone, against ${registryUrl}`)
    must('git clone', 'git', ['clone', '--quiet', REPO, clone])
    must('git config', 'git', ['-C', clone, 'config', 'user.email', 'install-check@localhost'])
    must('git config', 'git', ['-C', clone, 'config', 'user.name', 'install-check'])
    symlinkSync(join(REPO, 'node_modules'), join(clone, 'node_modules'))
    const lock = await runAsync(process.execPath, ['scripts/bridge-lock.mjs'], { cwd: clone, env: { ...process.env, npm_config_registry: registryUrl } })
    expect(lock.status === 0, `bridge-lock wrote, committed and tagged the bridge's lockfile${lock.status === 0 ? '' : `:\n${lock.stdout}${lock.stderr}`}`)
    must('git clone --bare', 'git', ['clone', '--quiet', '--bare', clone, join(temp, 'marketplace.git')])

    console.log(`\n== installed from the marketplace at ${gitUrl}`)
    const env = personEnv(`${registryUrl}/`)
    await mustAsync('marketplace add', 'claude', ['plugin', 'marketplace', 'add', gitUrl], { cwd: work, env })
    await mustAsync('plugin install', 'claude', ['plugin', 'install', 'mod-lab-bridge@claude-mod-lab'], { cwd: work, env })
    const copies = join(config, 'plugins', 'cache', 'claude-mod-lab', 'mod-lab-bridge')
    const copy = existsSync(copies) ? join(copies, readdirSync(copies)[0]) : copies
    expect(existsSync(join(copy, 'node_modules', 'claude-mod-lab', 'web', 'server.mjs')), `the install put claude-mod-lab in ${copy}/node_modules`)
    expect(existsSync(join(copy, 'node_modules', 'typescript', 'package.json')), 'and typescript beside it')

    console.log('\n== a session of the installed lab')
    const port = await freePort()
    const session = spawn('claude', ['-p', '--permission-mode', 'default', '/mod-lab explorer serve 40'], {
      cwd: work,
      env: { ...env, MOD_LAB_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const page = `http://localhost:${port}`
    let token
    for (let tries = 0; tries < 60 && token === undefined; tries += 1) {
      await new Promise(done => setTimeout(done, 500))
      const html = await fetch(page).then(res => res.text()).catch(() => '')
      token = /name="lab-token" content="([^"]+)"/.exec(html)?.[1]
    }
    expect(token !== undefined, `the session's explorer served the page at ${page}`)
    if (token !== undefined) {
      const headers = { 'x-lab-token': token, 'content-type': 'application/json' }
      const state = async () => (await fetch(`${page}/api/state`, { headers })).json()
      let seen = await state()
      for (let tries = 0; tries < 30 && !seen.session?.isConnected; tries += 1) {
        await new Promise(done => setTimeout(done, 500))
        seen = await state()
      }
      expect(seen.session?.isConnected === true && String(seen.session.plugin?.root).startsWith(copies), 'the installed bridge connected to it')
      await fetch(`${page}/api/run`, { method: 'POST', headers, body: JSON.stringify({ probe: 'session.cwd', args: {} }) })
      await new Promise(done => setTimeout(done, 3000))
      const run = (await state()).runs.findLast(one => one.probe === 'session.cwd')
      expect(run?.ok === true, `a probe run from the page answered (${JSON.stringify(run?.value)})`)
    }
    const logs = join(config, 'plugins', 'data')
    const log = existsSync(logs) ? readdirSync(logs).map(dir => join(logs, dir, 'explorer.log')).find(existsSync) : undefined
    expect(log !== undefined && readFileSync(log, 'utf8').includes(`from ${copy}/node_modules/claude-mod-lab`), 'the explorer served from the installed package')
    session.kill('SIGTERM')
  } finally {
    npm.close()
    git.close()
  }
}

try {
  await main()
} catch (error) {
  expect(false, error instanceof Error ? error.message : String(error))
}
if (process.argv.includes('--keep')) console.log(`\nleft in ${temp}`)
else rmSync(temp, { recursive: true, force: true })
console.log(failures.length === 0 ? '\nthe installed route works' : `\n${failures.length} check(s) failed`)
process.exitCode = failures.length === 0 ? 0 : 1
