// The explorer inside the session: the stdio MCP server that the
// .mcp.json beside it declares, which Claude Code starts with the session and
// stops with it. It answers MCP on stdin and stdout, and serves the explorer
// page from the claude-mod-lab package it finds: at once when MOD_LAB_OPEN is
// 1, otherwise once the lab asks through its start tool. Until then it listens
// on no port and builds no reference. stdout carries MCP messages alone: the
// log goes to explorer.log in the plugin's data folder, and stderr.
//
// What it reads from the environment, which .mcp.json passes on by name so
// that it arrives when CLAUDE_CODE_MCP_ALLOWLIST_ENV is set:
//   MOD_LAB_PACKAGE_ROOT  the package to serve from; else node_modules/claude-mod-lab in this
//                         plugin, else the clone this plugin is in (mods/mod-lab-bridge)
//   MOD_LAB_OPEN          1: serve at once and open the browser
//   MOD_LAB_NO_OPEN       1: serve without opening the browser
//   MOD_LAB_PORT          the first port to try, else web/server.mjs's default; the next free one is taken after it
//   MOD_LAB_BRIDGE_OPTION, MOD_LAB_BRIDGE_FILE
//                         the bridge's override (its bridgeFile option, then the variable): the bridge
//                         file of an explorer started separately, which the bridge connects to instead,
//                         so this one never listens
//   MOD_LAB_LESSONS       an explicitly initialized lesson workspace, or empty
//   MOD_LAB_TYPES         the declarations used for the reference
//   BROWSER               the command that opens the page, in place of the platform's own

import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  truncateSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

const env = process.env
const PLUGIN_ROOT = env.CLAUDE_PLUGIN_ROOT || dirname(fileURLToPath(import.meta.url))
const { version: VERSION } = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
const PACKAGE = 'claude-mod-lab'
// How many ports after the first are tried while each is taken: one for each session running at once.
const MORE_PORTS = 20
const LOG_LIMIT = 1024 * 1024
// How long stopping waits for the server to close: Claude Code sends SIGKILL 500 ms after SIGINT.
const CLOSE_MS = 300
// The longest the endpoint tool holds its answer for the explorer to serve.
const MAX_WAIT_SECONDS = 600

const TOOLS = [
  {
    name: 'init-lessons',
    description: 'Enables lessons in the current project without replacing existing files. Used by /init-lessons.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: "The session's absolute working directory." },
        collection: {
          type: 'string',
          description: "The current project's component directory already watched by this session.",
        },
      },
      required: ['cwd'],
      additionalProperties: false,
    },
  },
  {
    name: 'start',
    description:
      'Starts the claude-mod-lab explorer for this session if it is idle, and answers its URL; or says why it cannot serve.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'endpoint',
    description:
      "For the mod-lab-bridge mod: the explorer's state as JSON, with its address and the token the bridge's requests carry while it serves. It never starts the explorer.",
    inputSchema: {
      type: 'object',
      properties: {
        wait: {
          type: 'number',
          description: `Seconds to hold the answer while the explorer does not serve, answering as soon as it does; at most ${MAX_WAIT_SECONDS}, none by default`,
        },
      },
    },
  },
]

const LOG = env.CLAUDE_PLUGIN_DATA ? join(env.CLAUDE_PLUGIN_DATA, 'explorer.log') : null
const SESSION = env.CLAUDE_CODE_SESSION_ID?.slice(0, 8) || `pid ${process.pid}`

function log(text) {
  const line = `${new Date().toISOString()} ${SESSION} ${text}\n`
  process.stderr.write(line)
  if (LOG === null) return
  try {
    appendFileSync(LOG, line)
  } catch {
    // stderr has it.
  }
}

function startLog() {
  if (LOG === null) return
  mkdirSync(dirname(LOG), { recursive: true })
  // One file for every session; it starts over once it passes the limit.
  if ((statSync(LOG, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT) truncateSync(LOG)
}

const messageOf = error => (error instanceof Error ? error.message : String(error))
const expandHome = path => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path)

/** Whether `dir` holds the package: its package.json names it, and it has the server. */
function isPackage(dir) {
  try {
    const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return name === PACKAGE && existsSync(join(dir, 'web', 'server.mjs'))
  } catch {
    return false
  }
}

/**
 * The package's folder, or why there is none.
 * @returns {{ root: string, problem: null } | { root: null, problem: string }}
 */
function findPackage() {
  const named = env.MOD_LAB_PACKAGE_ROOT
  if (named) {
    const dir = resolve(named)
    return isPackage(dir)
      ? { root: dir, problem: null }
      : { root: null, problem: `MOD_LAB_PACKAGE_ROOT names ${dir}, which does not hold the ${PACKAGE} package` }
  }
  const installed = join(PLUGIN_ROOT, 'node_modules', PACKAGE)
  if (isPackage(installed)) return { root: installed, problem: null }
  const clone = resolve(PLUGIN_ROOT, '..', '..')
  if (isPackage(clone)) return { root: clone, problem: null }
  return {
    root: null,
    problem:
      `the ${PACKAGE} package was not found, neither in ${installed} nor at ${clone}, as in a clone. ` +
      'Set MOD_LAB_PACKAGE_ROOT to a copy of it (a clone of the repository, or node_modules/claude-mod-lab ' +
      'after npm install claude-mod-lab) before starting Claude Code',
  }
}

/** The bridge's override, expanded: its bridgeFile option, else MOD_LAB_BRIDGE_FILE; null when neither is set. */
function overrideFile() {
  const given = env.MOD_LAB_BRIDGE_OPTION || env.MOD_LAB_BRIDGE_FILE
  return given ? expandHome(given) : null
}

const override = overrideFile()
const found = override === null ? findPackage() : { root: null, problem: null }
/**
 * What the explorer is doing: `override` (the bridge uses another), `idle`
 * until asked, `starting`, `serving`, or `unavailable` with the reason.
 * @type {{ kind: 'override' | 'idle' | 'starting' | 'serving' | 'unavailable', reason?: string }}
 */
let state =
  override !== null
    ? { kind: 'override' }
    : found.problem
      ? { kind: 'unavailable', reason: found.problem }
      : { kind: 'idle' }
/** startServer's answer once it serves. */
let served = null
/** The page's address as the person opens it, on localhost. */
let page = ''
let starting = null
let markServing = () => {}
/** Settles once the explorer serves. @type {Promise<void>} */
const serving = new Promise(done => (markServing = () => done()))

/** Starts serving; a call while a start is under way waits on it, and one after a failed start tries again. */
function serve() {
  starting ??= start()
  return starting
}

async function start() {
  state = { kind: 'starting' }
  try {
    const { startServer } = await import(pathToFileURL(join(found.root, 'web', 'server.mjs')).href)
    const workspace = resolve(env.CLAUDE_PROJECT_DIR || process.cwd())
    served = await startServer({
      port: env.MOD_LAB_PORT ? Number(env.MOD_LAB_PORT) : undefined,
      fallback: MORE_PORTS,
      workspace,
      lessonWorkspace: env.MOD_LAB_LESSONS || null,
      typesPath: env.MOD_LAB_TYPES || undefined,
    })
    page = `http://localhost:${new URL(served.url).port}`
    state = { kind: 'serving' }
    markServing()
    const reference = served.reference()
    log(`serving at ${page} from ${found.root}, for ${workspace}`)
    log(
      reference === null
        ? `reference: ${served.catalogProblem()}`
        : `reference: ${reference.path} (${reference.found})`,
    )
  } catch (error) {
    state = { kind: 'unavailable', reason: `the explorer did not start: ${messageOf(error)}` }
    starting = null
    log(state.reason)
  }
}

function openBrowser(url) {
  const [command, ...args] = env.BROWSER
    ? [env.BROWSER]
    : process.platform === 'darwin'
      ? ['open']
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '']
        : ['xdg-open']
  const child = spawn(command, [...args, url], { detached: true, stdio: 'ignore' })
  child.on('error', error => log(`the browser did not open (${command}): ${error.message}`))
  child.unref()
}

/** The override's explorer, as its bridge file names it; null before one has written it. */
function overrideUrl() {
  try {
    const { url } = JSON.parse(readFileSync(override, 'utf8'))
    return typeof url === 'string' ? url : null
  } catch {
    return null
  }
}

/** What the start tool answers, in a sentence or two; `isError` when there is no explorer to use. */
function startAnswer() {
  if (state.kind === 'override') {
    const url = overrideUrl()
    return {
      isError: false,
      text:
        `This session's bridge connects to the explorer that writes ${override} (the bridgeFile option or MOD_LAB_BRIDGE_FILE)` +
        (url === null ? ', and none has written it yet.' : `, at ${url}.`) +
        ' This server does not serve one of its own.',
    }
  }
  if (state.kind === 'serving') {
    const isConnected = served.hub.snapshot().session?.isConnected === true
    return {
      isError: false,
      text: `The explorer is at ${page}. ${isConnected ? 'This session is connected to it.' : "This session's bridge connects to it within a few seconds."}`,
    }
  }
  const where = LOG === null ? '' : ` Its log: ${LOG}.`
  return { isError: true, text: `The explorer cannot serve: ${state.reason}.${where}` }
}

/** What the endpoint tool answers, for the bridge; asked to wait, not before the explorer serves or the wait ends. */
async function endpointAnswer(wait) {
  const seconds = Math.min(Math.max(Number(wait) || 0, 0), MAX_WAIT_SECONDS)
  if (state.kind !== 'serving' && state.kind !== 'override' && seconds > 0) {
    let timer
    await Promise.race([serving, new Promise(done => (timer = setTimeout(done, seconds * 1000)))])
    clearTimeout(timer)
  }
  if (state.kind === 'serving') return { state: 'serving', url: served.url, token: served.token, page }
  if (state.kind === 'unavailable') return { state: state.kind, reason: state.reason }
  if (state.kind === 'override') return { state: state.kind, file: override }
  return { state: state.kind }
}

async function callTool(name, args) {
  if (name === 'init-lessons') return initializeLessons(args)
  if (name === 'start') {
    const connected = await connectedSharedExplorer()
    if (connected !== null)
      return {
        content: [{ type: 'text', text: `This session is connected to the explorer at ${connected}.` }],
        isError: false,
      }
    // Without the package there is nothing to start; a start that failed is tried again.
    if (found.root !== null && state.kind !== 'serving') await serve()
    const { text, isError } = startAnswer()
    return { content: [{ type: 'text', text }], isError }
  }
  if (name === 'endpoint')
    return { content: [{ type: 'text', text: JSON.stringify(await endpointAnswer(args?.wait)) }], isError: false }
  return { content: [{ type: 'text', text: `no tool is named ${name}` }], isError: true }
}

function checkLessonCollection(cwd, collection) {
  if (collection === undefined) return
  const expected = join(realpathSync(cwd), '.claude', 'mod-lab')
  if (collection !== expected)
    throw new Error('The lesson collection must be this project’s .claude/mod-lab directory.')
  for (const path of [dirname(expected), expected]) {
    if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`The lesson collection needs an existing directory without symlinks: ${path}`)
    }
  }
}

async function initializeLessons(args) {
  try {
    if (typeof args?.cwd !== 'string' || !isAbsolute(args.cwd)) {
      throw new Error('init-lessons needs the session’s absolute working directory.')
    }
    const source = findPackage()
    if (source.root === null) throw new Error(source.problem)
    checkLessonCollection(args.cwd, args.collection)
    const { initializeProjectLessons } = await import(pathToFileURL(join(source.root, 'web', 'lib', 'roots.mjs')).href)
    const workspace = initializeProjectLessons(args.cwd)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ workspace }),
        },
      ],
      isError: false,
    }
  } catch (error) {
    return { content: [{ type: 'text', text: messageOf(error) }], isError: true }
  }
}

function connectedToThisSession(session) {
  return session?.isConnected && session.facts?.id === env.CLAUDE_CODE_SESSION_ID
}

/** An installed bridge may already be using the shared explorer when /mod-lab explorer is asked. */
async function connectedSharedExplorer() {
  if (state.kind !== 'idle' || !env.CLAUDE_CODE_SESSION_ID || env.MOD_LAB_OPEN === '1') return null
  try {
    const { url, token } = JSON.parse(readFileSync(join(homedir(), '.claude-mod-lab', 'bridge.json'), 'utf8'))
    const endpoint = new URL(url)
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return null
    const response = await fetch(new URL('/api/state', endpoint), {
      headers: { 'x-lab-token': token },
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    })
    if (!response.ok) return null
    const { session } = await response.json()
    return connectedToThisSession(session) ? endpoint.origin : null
  } catch {
    return null
  }
}

class MethodNotFound extends Error {
  code = -32601
}

async function answer(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'mod-lab-explorer', version: VERSION },
    }
  }
  if (message.method === 'ping') return {}
  if (message.method === 'tools/list') return { tools: TOOLS }
  if (message.method === 'tools/call') return callTool(message.params?.name, message.params?.arguments)
  throw new MethodNotFound(`no method ${message.method}`)
}

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)

function receive(line) {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    log(`not a JSON message on stdin: ${line.slice(0, 200)}`)
    return
  }
  // Notifications and answers to requests of the client's own want no answer.
  if (typeof message?.method !== 'string' || message.id === undefined || message.id === null) return
  answer(message).then(
    result => {
      send({ jsonrpc: '2.0', id: message.id, result })
      if (message.method === 'initialize' && env.MOD_LAB_OPEN === '1' && state.kind === 'idle') {
        void serve().then(() => state.kind === 'serving' && env.MOD_LAB_NO_OPEN !== '1' && openBrowser(page))
      }
    },
    error => send({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: messageOf(error) } }),
  )
}

let isStopping = false
async function stop(why) {
  if (isStopping) return
  isStopping = true
  log(`stopping: ${why}`)
  setTimeout(() => process.exit(0), CLOSE_MS).unref()
  await served?.close()
  process.exit(0)
}

startLog()
// stdout is the MCP channel, so what the package's code logs goes to the log instead.
for (const name of ['log', 'info', 'warn', 'debug']) console[name] = (...args) => log(args.map(String).join(' '))
process.on('uncaughtException', error => {
  log(`stopped on an uncaught error: ${error.stack ?? error.message}`)
  process.exit(1)
})
process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
process.stdin.on('end', () => void stop('the session closed stdin'))
createInterface({ input: process.stdin }).on('line', receive)
log(
  state.kind === 'override'
    ? `the bridge uses ${override}, so this server does not serve`
    : state.kind === 'unavailable'
      ? `cannot serve: ${state.reason}`
      : `idle, with the package at ${found.root}${env.MOD_LAB_OPEN === '1' ? '; serving once the session connects' : ''}`,
)
