// The explorer's local server: serves the page, the $ reference built from
// the engine's declarations, and the bridge the mod-lab-bridge mod polls.
// The bridge plugin's MCP server (mods/mod-lab-bridge/explorer.mjs) runs it
// inside a session; `npm run explorer` runs it on its own. docs/design.md
// describes the protocol.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readAnatomy } from './lib/anatomy.mjs'
import { buildCatalog } from './lib/catalog.mjs'
import { createBuildApi } from './lib/build-api.mjs'
import { createWorkspaceContext } from './lib/workspace-context.mjs'
import { createStubs } from './lib/stubs.mjs'
import { FILLER_WORDS, fillerText } from './lib/filler.mjs'
import { readGallery } from './lib/gallery.mjs'
import { BRIDGE_PROTOCOL, compatOf, createHub } from './lib/hub.mjs'
import { PACKAGE_ROOT } from './lib/roots.mjs'
import { labFolders, packageFacts } from './lib/session-folders.mjs'
import { findRecord, isUuid, transcriptPath } from './lib/transcript.mjs'
import { findTypes, missingTypes, SKILL_BASES } from './lib/types-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, 'public')
const STATIC = /^\/([a-z0-9-]+)\.(js|css|svg)$/
// Fonts the page carries itself, in web/public/fonts/, so it needs no network.
const FONT = /^\/fonts\/([a-z0-9-]+)\.woff2$/
const TYPES = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }
const MAX_BODY = 4 * 1024 * 1024
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // Timeline and chart renderers set positions and sizes through style attributes.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

/** The package's compat.json, for the templates' minimums; null where it cannot be read. */
function readCompat() {
  try {
    return compatOf(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'compat.json'), 'utf8')))
  } catch {
    return null
  }
}

function send(res, status, body, type = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((done, fail) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        fail(new Error('body too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        done(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        fail(error)
      }
    })
    req.on('error', fail)
  })
}

/**
 * Starts the server. Every request must name this server as its Host (which
 * stops DNS rebinding) and carry the token: as a bearer token from the mod,
 * as X-Lab-Token or ?token= from the page, which gets it in its own HTML.
 *
 * @param {object} [options]
 * @param {number} [options.port] 0 picks a free one
 * @param {number} [options.fallback] how many ports after `port` to try, in turn, while each is taken
 * @param {string} [options.host]
 * @param {string} [options.token]
 * @param {string} [options.typesPath] the declaration file (MOD_LAB_TYPES); looked for in lib/types-path.mjs's order when not given
 * @param {string} [options.bridgeFile] where to write the address and token for the bridge mod
 * @param {ReturnType<typeof createHub>} [options.hub]
 * @param {string} [options.workspace] an explicitly selected project, used until a session connects
 * @param {string | null} [options.lessonWorkspace] an explicitly initialized lesson workspace
 * @param {() => ReturnType<typeof readAnatomy>} [options.anatomy]
 * @param {string} [options.sandboxDir] the Sandbox page's mod; workshop/sandbox-mod when not given
 * @param {ReturnType<typeof import('./lib/lesson-checks.mjs').createLessonChecks>} [options.lessonChecks] the checks of the open lesson as it is saved
 * @param {string} [options.skillsDir] where Add to session copies components; the workspace's .claude/skills/ when not given
 * @param {string[]} [options.pluginRoots] where to look for laid declarations until a session names its own plugins: mod-lab's and mod-lab-bridge's folders as `npx claude-mod-lab` loads them, the package's own in a clone and the copies in ~/.claude-mod-lab/plugins/<version>/ from an npm install
 * @param {(names: string[]) => ReturnType<typeof import('./lib/installed.mjs').installedCopies>} [options.installed] the enabled installed copies of the plugins named, in the workspace; an installed copy keeps one Add to session made from loading
 * @param {string[]} [options.skillBases] the temp folders holding the plugin-authoring skill's copies
 */
export async function startServer({
  port = 4977,
  fallback = 0,
  host = '127.0.0.1',
  token = randomBytes(24).toString('hex'),
  typesPath,
  bridgeFile,
  hub = createHub(),
  workspace,
  lessonWorkspace = null,
  anatomy,
  sandboxDir,
  lessonChecks,
  skillsDir,
  pluginRoots = labFolders({ packageRoot: PACKAGE_ROOT, home: homedir(), ...packageFacts(PACKAGE_ROOT) }).slice(0, 2),
  installed,
  skillBases = SKILL_BASES,
} = {}) {
  const context = createWorkspaceContext({ hub, workspace, lessonWorkspace })
  /** @type {(ReturnType<typeof buildCatalog> & { found: string }) | null} */
  let catalog = null
  // The file the reference was built from, and its time, so a lookup that finds it again does not parse it again.
  let built = { path: '', mtimeMs: 0 }
  let catalogProblem = null
  let catalogLooked = []
  // Reading every mod runs claude plugin validate on each, so a reading is kept for a minute.
  let anatomyRead = null
  // The intercept form's stubs, from the file the reference was built from; built at the first request, again when that file changes.
  let stubs = { built: '', stubsFor: null }
  const stubsFor = event => {
    const key = `${built.path}:${built.mtimeMs}`
    if (stubs.built !== key) stubs = { built: key, stubsFor: createStubs(built.path).stubsFor }
    return stubs.stubsFor(event)
  }
  /**
   * Looks for the declarations in lib/types-path.mjs's order and builds the reference from
   * what it finds, unless that is the file it has. A lookup that finds
   * nothing keeps the reference it has, and one that fails says so instead
   * of failing the request that asked.
   *
   * @param {{ roots: string[], version?: string }} lookup the plugins the session loaded, and its Claude Code version
   */
  const lookUp = ({ roots, version }) => {
    let path = null
    try {
      const found = findTypes({
        explicit: typesPath,
        roots,
        workspace: context.snapshot().project ?? undefined,
        version,
        bases: skillBases,
      })
      catalogLooked = found.looked
      path = found.path
      if (path === null) {
        if (catalog === null) catalogProblem = missingTypes(found)
        return
      }
      const { mtimeMs } = statSync(path)
      if (catalog !== null && built.path === path && built.mtimeMs === mtimeMs) return
      catalog = { ...buildCatalog(readFileSync(path, 'utf8'), { path }), found: found.found }
      built = { path, mtimeMs }
      catalogProblem = null
    } catch (error) {
      if (catalog === null)
        catalogProblem = `the declarations${path === null ? '' : ` at ${path}`} could not be read: ${error.message}`
    }
  }
  lookUp({ roots: pluginRoots })
  const buildApi = createBuildApi({
    context,
    hub,
    send,
    readBody,
    currentTypes: () => catalog?.path ?? null,
    compat: readCompat,
    sandboxDir,
    skillsDir,
    lessonChecks,
    installed,
  })

  const index = () => readFileSync(join(PUBLIC, 'index.html'), 'utf8').replace('__LAB_TOKEN__', token)
  let address = ''

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    const url = new URL(req.url ?? '/', 'http://local')
    if (req.headers.host !== address && req.headers.host !== address.replace('127.0.0.1', 'localhost')) {
      return send(res, 403, { error: 'this server answers only to its own address' })
    }
    try {
      if (url.pathname === '/' && req.method === 'GET') return send(res, 200, index(), 'text/html')
      const file = STATIC.exec(url.pathname)
      if (file !== null && req.method === 'GET' && existsSync(join(PUBLIC, `${file[1]}.${file[2]}`))) {
        return send(res, 200, readFileSync(join(PUBLIC, `${file[1]}.${file[2]}`), 'utf8'), TYPES[file[2]])
      }
      const font = FONT.exec(url.pathname)
      if (font !== null && req.method === 'GET' && existsSync(join(PUBLIC, 'fonts', `${font[1]}.woff2`))) {
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' })
        return res.end(readFileSync(join(PUBLIC, 'fonts', `${font[1]}.woff2`)))
      }
      if (url.pathname.startsWith('/bridge/')) {
        if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'bad token' })
        return await bridge(req, res, url)
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-lab-token'] !== token && url.searchParams.get('token') !== token) {
          return send(res, 401, { error: 'bad token' })
        }
        if (url.pathname.startsWith('/api/sandbox')) return await buildApi.sandboxApi(req, res, url)
        if (url.pathname.startsWith('/api/components')) return await buildApi.componentsApi(req, res, url)
        if (url.pathname.startsWith('/api/lesson') || url.pathname === '/api/check')
          return await buildApi.lessonApi(req, res, url)
        if (url.pathname.startsWith('/api/workshop')) return await buildApi.workshopApi(req, res, url)
        return await api(req, res, url)
      }
      return send(res, 404, { error: 'not found' })
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  async function bridge(req, res, url) {
    if (url.pathname === '/bridge/hello' && req.method === 'POST') {
      const body = await readBody(req)
      const greeted = hub.hello(body)
      if ('error' in greeted) return send(res, 409, greeted)
      buildApi.synchronize()
      anatomyRead = null
      // Looks again with the plugins this session loaded, mod-lab's first, and its version. The page asks for
      // the reference again once the session connects, which is after this has run.
      const roots = [body.lab?.root, body.plugin?.root].filter(root => typeof root === 'string' && isAbsolute(root))
      const version = typeof body.session?.version === 'string' ? body.session.version : undefined
      lookUp({ roots, version })
      return send(res, 200, greeted)
    }
    if (url.pathname === '/bridge/next' && req.method === 'GET') {
      const job = hub.next(url.searchParams.get('client'))
      if (job === undefined) return send(res, 410, { error: 'unknown client; say hello again' })
      if (job === null) {
        res.writeHead(204)
        return res.end()
      }
      return send(res, 200, { job })
    }
    if (url.pathname === '/bridge/runs' && req.method === 'POST') {
      const body = await readBody(req)
      return hub.addRuns(body.client, body.runs, body.job)
        ? send(res, 200, {})
        : send(res, 410, { error: 'unknown client' })
    }
    if (url.pathname === '/bridge/traces' && req.method === 'POST') {
      const body = await readBody(req)
      return hub.addTraces(body.client, body.rows) ? send(res, 200, {}) : send(res, 410, { error: 'unknown client' })
    }
    if (url.pathname === '/bridge/taps' && req.method === 'POST') {
      const body = await readBody(req)
      return hub.addTaps(body.client, body.taps) ? send(res, 200, {}) : send(res, 410, { error: 'unknown client' })
    }
    if (url.pathname === '/bridge/mirror' && req.method === 'POST') {
      const body = await readBody(req)
      const mirrored = hub.mirror(body.client, body.key, body.value)
      return mirrored === null
        ? send(res, 400, { error: 'not a key the explorer mirrors' })
        : mirrored
          ? send(res, 200, {})
          : send(res, 410, { error: 'unknown client' })
    }
    if (url.pathname === '/bridge/answer' && req.method === 'POST') {
      const body = await readBody(req)
      return hub.answer(body.client, body.job, body.text)
        ? send(res, 200, {})
        : send(res, 410, { error: 'unknown client' })
    }
    return send(res, 404, { error: 'not found' })
  }

  async function api(req, res, url) {
    if (url.pathname === '/api/context' && req.method === 'GET')
      return send(res, 200, { ...context.snapshot(), protocol: BRIDGE_PROTOCOL })
    if (url.pathname === '/api/catalog' && req.method === 'GET') {
      if (catalog === null) return send(res, 503, { error: catalogProblem, looked: catalogLooked })
      // JSON leaves out the type lookup, a function; /api/type answers it.
      return send(res, 200, catalog)
    }
    if (url.pathname === '/api/type' && req.method === 'GET') {
      const found = catalog?.type(url.searchParams.get('name') ?? '') ?? null
      return found === null ? send(res, 404, { error: 'no such type' }) : send(res, 200, found)
    }
    if (url.pathname === '/api/stubs' && req.method === 'GET') {
      if (catalog === null) return send(res, 404, { error: 'no declarations to take stubs from' })
      return send(res, 200, stubsFor(url.searchParams.get('event') ?? ''))
    }
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, hub.snapshot())
    if (url.pathname === '/api/transcript' && req.method === 'GET') {
      // One record of the connected session's transcript file, by a row's uuid, for the X-ray's row dialog.
      const uuid = url.searchParams.get('uuid') ?? ''
      if (!isUuid(uuid)) return send(res, 400, { error: 'uuid must be a row id, as session.append gives it' })
      const facts = hub.snapshot().session?.facts
      if (typeof facts?.id !== 'string' || typeof facts?.cwd !== 'string')
        return send(res, 409, { error: 'no session is connected, so there is no transcript file to read' })
      const path = transcriptPath({ cwd: facts.cwd, sessionId: facts.id })
      if (!existsSync(path)) return send(res, 404, { error: `no transcript file at ${path}`, path })
      const found = await findRecord(path, uuid)
      if (found === null) return send(res, 404, { error: 'the transcript file has no record with this id', path })
      return send(res, 200, { ...found, path })
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req)
      const queued = hub.enqueue(String(body.probe ?? ''), body.args ?? {})
      return 'error' in queued ? send(res, 409, queued) : send(res, 200, queued)
    }
    if (url.pathname === '/api/command' && req.method === 'POST') {
      const body = await readBody(req)
      const queued = hub.enqueueCommand(body.text)
      return 'error' in queued ? send(res, 409, queued) : send(res, 200, queued)
    }
    if (url.pathname === '/api/anatomy' && req.method === 'GET') {
      if (anatomyRead === null || url.searchParams.get('fresh') === '1' || Date.now() - anatomyRead.at > 60_000) {
        const root = context.snapshot().lessonWorkspace
        anatomyRead = {
          at: Date.now(),
          mods: await (anatomy
            ? anatomy()
            : readAnatomy(join(PACKAGE_ROOT, 'mods'), root === null ? null : join(root, 'workshop'))),
        }
      }
      return send(res, 200, anatomyRead)
    }
    if (url.pathname === '/api/sample' && req.method === 'GET') {
      // Long text for the workbench's cached prefix, generated, by size name.
      const name = url.searchParams.get('name') ?? ''
      if (!Object.hasOwn(FILLER_WORDS, name)) return send(res, 404, { error: 'no such sample' })
      return send(res, 200, { text: fillerText(FILLER_WORDS[name]) })
    }
    if (url.pathname === '/api/gallery' && req.method === 'GET') {
      const dir = join(PACKAGE_ROOT, 'mods', 'gallery-mod')
      return send(res, 200, { elements: catalog?.elements ?? [], dir, ...readGallery(dir) })
    }
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      write('snapshot', hub.snapshot())
      const stop = hub.subscribe(write)
      // The session's connection goes stale without an event, so it is sent again on a beat.
      const beat = setInterval(() => {
        buildApi.synchronize()
        write('session', hub.snapshot().session)
      }, 3_000)
      req.on('close', () => {
        stop()
        clearInterval(beat)
      })
      return undefined
    }
    return send(res, 404, { error: 'not found' })
  }

  const listen = at =>
    new Promise((done, fail) => {
      server.once('error', fail)
      server.listen(at, host, () => {
        server.off('error', fail)
        done()
      })
    })
  for (let tried = 0; ; tried += 1) {
    try {
      await listen(port === 0 ? 0 : port + tried)
      break
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port === 0 || tried >= fallback) throw error
    }
  }
  address = `${host}:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`
  const url = `http://${address}`

  if (bridgeFile) {
    mkdirSync(dirname(bridgeFile), { recursive: true, mode: 0o700 })
    writeFileSync(bridgeFile, JSON.stringify({ url, token, pid: process.pid }), { mode: 0o600 })
    chmodSync(bridgeFile, 0o600)
  }

  const close = () =>
    new Promise(done => {
      if (bridgeFile) {
        try {
          if (JSON.parse(readFileSync(bridgeFile, 'utf8')).token === token) rmSync(bridgeFile)
        } catch {
          // Already gone, or another server's now.
        }
      }
      buildApi.close()
      server.closeAllConnections()
      server.close(() => done())
    })

  return {
    url,
    token,
    close,
    hub,
    workspace,
    catalogProblem: () => catalogProblem,
    catalogPath: () => catalog?.path ?? null,
    /** The reference's file, the Claude Code version its header names, and where it was found; null while there is none. */
    reference: () => (catalog === null ? null : { path: catalog.path, version: catalog.version, found: catalog.found }),
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const bridgeFile = process.env.MOD_LAB_BRIDGE_FILE ?? join(homedir(), '.claude-mod-lab', 'bridge.json')
  const port = Number(process.env.MOD_LAB_PORT ?? 4977)
  const typesPath = process.env.MOD_LAB_TYPES || undefined
  const started = await startServer({ port, typesPath, bridgeFile })
  const reference = started.reference()
  console.log(`mod-lab explorer: ${started.url}`)
  console.log(
    reference === null
      ? `reference: ${started.catalogProblem()}`
      : `reference: ${reference.path} (Claude Code ${reference.version ?? 'unstated'}, ${reference.found})`,
  )
  console.log(`bridge file: ${bridgeFile}`)
  const stop = async () => {
    await started.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
