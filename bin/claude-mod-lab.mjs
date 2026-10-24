#!/usr/bin/env node
// claude-mod-lab opens the explorer; run starts a project session, and
// init-lessons explicitly creates a lesson workspace. --help lists the commands.
// In a clone, `npx claude-mod-lab` runs this file with nothing downloaded.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { constants, homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { copyMod } from '../web/lib/components.mjs'
import { componentFolder, legacyComponentFolders } from '../web/lib/component-folders.mjs'
import { installedCopies, sessionCopyNote, sideloadRefusal, skillsCopyNote } from '../web/lib/installed.mjs'
import { isWorkspace, labFolder, makeWorkspace, PACKAGE_ROOT, workspaceRoot } from '../web/lib/roots.mjs'
import { templateNames } from '../web/lib/sandbox.mjs'
import { packageFacts, sessionFolders } from '../web/lib/session-folders.mjs'
import { BRIDGE_PROTOCOL } from '../web/lib/hub.mjs'

// A git checkout loads the lab's folders in place, an npm install copies of them (web/lib/session-folders.mjs).
const { version, inPlace } = packageFacts(PACKAGE_ROOT)

const HELP = `Usage: claude-mod-lab [--no-open] [--port <port>]
       claude-mod-lab run [project] [options] [-- claude options]
       claude-mod-lab init-lessons <directory> [--pin]
       claude-mod-lab learn|add ...

  (no command), serve  open a running explorer, or start one in this terminal.
                       No project files are created. Ctrl-C stops a new explorer.
    --no-open          print the address without opening a browser
    --port <port>      use a separate explorer on this port (0 chooses a free port)

  run [project]        start Claude Code with the lab in an existing project,
                       defaulting to the current directory. Connect to an available
                       explorer, or start one that ends with the session.
                       Creates .claude/mod-lab/ for mods you add.
    --new              start a separate explorer even if one is available
    --no-open          do not open the browser for this session
    --port <port>      connect to the explorer selected with this port
                       Other options go to claude: --model haiku, -p "<prompt>".
                       Use -- before Claude options that share the lab's names.
  attach [project]     alias for run; starts a new Claude Code session

  init-lessons <dir>   create a lesson workspace in a new or empty directory.
                       Then run it with claude-mod-lab run <dir>.
    --pin              install this exact package version in the lesson workspace
  learn [lesson]       list lessons and progress; with a lesson, check on each save
    --once             check once and exit, 0 when every checked step passes
    --dir <folder>     check this folder instead of workshop/<mod>
    --no-types         skip the TypeScript step

  add [template]       copy a template to .claude/skills/<name>/ in this project;
                       with no name, list available templates
    --to <folder>      copy it to this folder instead

  -h, --help           this text
  -v, --version        the package's version

Only an initialized lesson workspace loads workshop/ when run starts a session.
learn and add use MOD_LAB_WORKSPACE when set, otherwise the current directory.
The launcher keeps plugin copies and connection information in ~/.claude-mod-lab/.
Claude Code (claude) must be on PATH to start sessions.`

/** How to get the lab without --plugin-dir: from its marketplace, as the README's install has it. */
const MARKETPLACE = `  claude plugin marketplace add hesreallyhim/claude-mod-lab
  claude plugin install mod-lab-bridge@claude-mod-lab --scope local`

class UsageError extends Error {}

/** An option and the value given with = (`--to=x`), if any. */
function split(arg) {
  const at = arg.indexOf('=')
  return arg.startsWith('--') && at !== -1 ? [arg.slice(0, at), arg.slice(at + 1)] : [arg, undefined]
}

/** The value of the option at `args[i]`: after its = or the next argument. Answers it and the index it ends at. */
function valueOf(args, i, what) {
  const [flag, inline] = split(args[i])
  const value = inline ?? args[i + 1]
  if (value === undefined || value === '') throw new UsageError(`${flag} needs ${what}`)
  return { value, end: inline === undefined ? i + 1 : i }
}

/** A path as the person would type it here: relative when it is under the current folder. */
function shown(path) {
  const rel = relative(process.cwd(), path)
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? path : rel
}

/** A folder named in a sentence: "this folder" for the current one. */
const where = dir => (resolve(dir) === resolve(process.cwd()) ? 'this folder' : shown(dir))

/**
 * Runs a command on this terminal and answers its exit status. SIGINT reaches
 * it from the terminal, so it is ignored here; SIGTERM and SIGHUP are passed on.
 */
function run(file, args, { cwd, env = {} }) {
  return new Promise(done => {
    const child = spawn(file, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
    const pass = signal => child.kill(signal)
    process.on('SIGINT', () => {})
    process.on('SIGTERM', pass)
    process.on('SIGHUP', pass)
    child.on('error', error => {
      const missing = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
      console.error(missing ? `${file} is not on the PATH${file === 'claude' ? ': install Claude Code first' : ''}` : error.message)
      done(1)
    })
    child.on('exit', (code, signal) => done(code ?? 128 + (signal === null ? 0 : constants.signals[signal])))
  })
}

/**
 * Pins this version in `workspace`: npm install, with a package.json written
 * first where there is none, since npm otherwise installs into the nearest
 * folder above that has one. Answers npm's exit status.
 */
function pin(workspace) {
  const manifest = join(workspace, 'package.json')
  if (!existsSync(manifest)) writeFileSync(manifest, '{ "private": true }\n')
  const spec = `claude-mod-lab@${version}`
  console.error(`claude-mod-lab: pinning ${spec} in ${where(workspace)}`)
  return run('npm', ['install', '--save-exact', '--ignore-scripts', spec], { cwd: workspace })
}

/** Explicitly creates a lesson workspace; starting a session is a separate action. */
async function initLessons(args) {
  const given = args.filter(arg => arg !== '--pin')
  if (given.length !== 1 || given[0].startsWith('-')) {
    throw new UsageError('init-lessons needs a directory: claude-mod-lab init-lessons <directory> [--pin].')
  }
  const chosen = labFolder({ folder: given[0] })
  const workspace = chosen.isNew ? makeWorkspace(chosen.dir) : chosen.dir
  console.log(`Lesson workspace: ${shown(workspace)}`)
  if (args.includes('--pin')) {
    const status = await pin(workspace)
    if (status !== 0) return status
  }
  console.log(`Start a session: npx claude-mod-lab run ${JSON.stringify(shown(workspace))}`)
  return 0
}

/** A port chosen by the person, including 0 for an ephemeral listener. */
function portNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new UsageError('--port needs a number from 0 to 65535.')
  return Number(value)
}

/** Explicit ports have their own discovery file; the override always wins. */
function sharedBridgeFile(port) {
  if (process.env.MOD_LAB_BRIDGE_FILE) return process.env.MOD_LAB_BRIDGE_FILE
  const root = join(homedir(), '.claude-mod-lab')
  return port === undefined ? join(root, 'bridge.json') : join(root, 'explorers', `${port}.json`)
}

function openBrowser(url) {
  const command = process.env.BROWSER || (process.platform === 'darwin' ? 'open' : 'xdg-open')
  spawn(command, [url], { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref()
}

const asLocalhost = url => url.replace(/^http:\/\/127\.0\.0\.1\b/, 'http://localhost')

/** Reads one launcher option and returns the index of its last argument. */
function explorerOption(options, args, index, allowClaude) {
  const [flag] = split(args[index])
  if (flag === '--no-open') options.noOpen = true
  else if (flag === '--new' && allowClaude) options.own = true
  else if (flag === '--port') {
    const { value, end } = valueOf(args, index, 'a port')
    options.port = portNumber(value)
    return end
  } else if (allowClaude && flag !== '--pin') options.passed.push(args[index])
  else throw new UsageError(`Unknown explorer option ${args[index]}. Use run to pass options to Claude, or init-lessons for --pin.`)
  return index
}

/** Reads explorer options without consuming options meant for Claude. */
function explorerOptions(args, allowClaude = false) {
  const options = { noOpen: false, own: false, port: undefined, passed: [] }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && allowClaude) {
      options.passed.push(...args.slice(i + 1))
      break
    }
    i = explorerOption(options, args, i, allowClaude)
  }
  return options
}

/** Only a well-formed loopback endpoint may receive the private bridge token. */
function readLocalEndpoint(bridgeFile) {
  try {
    const endpoint = JSON.parse(readFileSync(bridgeFile, 'utf8'))
    if (typeof endpoint?.url !== 'string' || typeof endpoint?.token !== 'string') return null
    const url = new URL(endpoint.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null
    return { url: url.origin, token: endpoint.token }
  } catch {
    return null
  }
}

/**
 * Returns a verified lab endpoint and its current session, or null for a stale
 * discovery file. Never follows redirects with the private bridge token.
 */
async function servingExplorer(bridgeFile) {
  const endpoint = readLocalEndpoint(bridgeFile)
  if (endpoint === null) return null
  const request = path => fetch(`${endpoint.url}${path}`, {
    headers: { 'X-Lab-Token': endpoint.token },
    signal: AbortSignal.timeout(2000),
    redirect: 'error',
  })
  try {
    const response = await request('/api/state')
    if (!response.ok) return null
    const state = await response.json()
    if (!Array.isArray(state.runs) || !Object.hasOwn(state, 'session')) return null
    const context = await request('/api/context')
    const compatible = context.ok && (await context.json()).protocol === BRIDGE_PROTOCOL
    return { url: endpoint.url, session: state.session, compatible }
  } catch {
    return null
  }
}

/** Starts an explorer without choosing a project or lesson workspace. */
async function serve(args) {
  const options = explorerOptions(args)
  const bridgeFile = sharedBridgeFile(options.port)
  const running = await servingExplorer(bridgeFile)
  if (running !== null) {
    if (!running.compatible) throw new UsageError(`The explorer at ${asLocalhost(running.url)} uses an older or incompatible server. Stop and restart it, or choose another explorer with --port <port>.`)
    console.log(`mod-lab explorer: ${asLocalhost(running.url)} (already running)`)
    if (!options.noOpen) openBrowser(asLocalhost(running.url))
    return 0
  }
  const { startServer } = await import('../web/server.mjs')
  const started = await startServer({
    port: options.port ?? Number(process.env.MOD_LAB_PORT ?? 4977),
    fallback: options.port === undefined ? 20 : 0,
    typesPath: process.env.MOD_LAB_TYPES || undefined,
    bridgeFile,
  })
  console.log(`mod-lab explorer: ${asLocalhost(started.url)}`)
  const selection = options.port === undefined ? '' : ` --port ${options.port}`
  console.log(`To connect a session, in your project: npx claude-mod-lab run${selection}`)
  console.log('Ctrl-C stops the explorer. Opening pages does not create project files.')
  if (!options.noOpen) openBrowser(asLocalhost(started.url))
  await new Promise(resolve => {
    const stop = () => void started.close().then(resolve)
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}

/** Chooses a shared idle explorer, or lets the session own a separate one. */
async function connectionFor(options) {
  if (options.own) return null
  const bridgeFile = sharedBridgeFile(options.port)
  const found = await servingExplorer(bridgeFile)
  if (found === null) return null
  if (!found.compatible) {
    console.error(`The explorer at ${asLocalhost(found.url)} is incompatible. Starting a separate explorer for this session.`)
    return null
  }
  if (found.session?.isConnected) {
    console.error(`The explorer at ${asLocalhost(found.url)} is connected to ${found.session.facts?.cwd ?? 'another session'}. Starting a separate explorer for this session.`)
    return null
  }
  return { ...found, bridgeFile }
}

/** Loads the lab and authoring skills, with a workshop added only for an initialized lesson directory. */
async function sessionPlugins(project, lessons) {
  const { folders, names, copyRoot, missing } = sessionFolders({
    packageRoot: PACKAGE_ROOT,
    home: homedir(),
    version,
    inPlace,
    workspace: lessons,
  })
  for (const name of missing) console.error(`claude-mod-lab is missing a bundled plugin: ${name}.`)
  if (copyRoot !== null) console.error(`claude-mod-lab: the lab's folders are copies in ${copyRoot}`)
  const { copies } = await installedCopies(names, { cwd: project })
  for (const copy of copies) console.error(sessionCopyNote(copy))
  return folders
}

/** A run targets an existing project; initialization belongs to init-lessons. */
function sessionProject(folder) {
  const requested = resolve(process.cwd(), folder)
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new UsageError(`${shown(requested)} is not a directory. run uses existing projects; init-lessons <directory> creates a lesson workspace.`)
  }
  return realpathSync(requested)
}

function sessionEnvironment(connection, options, lessons, isInteractive, componentDirs) {
  return {
    MOD_LAB_NODE: process.execPath,
    MOD_LAB_PACKAGE_ROOT: PACKAGE_ROOT,
    MOD_LAB_WORKSPACE: '',
    MOD_LAB_LESSONS: lessons ?? '',
    MOD_LAB_COMPONENT_DIRS: JSON.stringify(componentDirs),
    MOD_LAB_BRIDGE_FILE: connection?.bridgeFile ?? '',
    MOD_LAB_OPEN: isInteractive && connection === null ? '1' : '',
    MOD_LAB_NO_OPEN: options.noOpen ? '1' : '',
    ...(options.port === undefined ? {} : { MOD_LAB_PORT: String(options.port) }),
  }
}

function announceConnection(connection, options, isInteractive) {
  if (connection === null) {
    console.error('Starting an explorer for this session. It stops when the session ends.')
    return
  }
  console.error(`Connecting this session to ${asLocalhost(connection.url)}. That explorer stays open after the session ends.`)
  if (isInteractive && !options.noOpen) openBrowser(asLocalhost(connection.url))
}

/** Creates the collection before Claude starts watching it; old copies remain in place. */
function projectComponents(project) {
  if (project === realpathSync(homedir())) return []
  const collection = componentFolder(project)
  mkdirSync(collection, { recursive: true })
  return [collection, ...legacyComponentFolders(project, PACKAGE_ROOT)]
}

/** Starts a project session with an explicit collection for components added through the explorer. */
async function startSession(args) {
  const hasFolder = args.length > 0 && !args[0].startsWith('-')
  const options = explorerOptions(hasFolder ? args.slice(1) : args, true)
  const project = sessionProject(hasFolder ? args[0] : '.')
  const lessons = project !== realpathSync(homedir()) && isWorkspace(project) ? project : null
  const refusal = await sideloadRefusal(project, { cwd: project })
  if (refusal !== null) {
    console.error(`${refusal}\n\nInstall the lab from its marketplace where your organization permits it:\n\n${MARKETPLACE}`)
    return 1
  }
  const connection = await connectionFor(options)
  const folders = await sessionPlugins(project, lessons)
  const componentDirs = projectComponents(project)
  const isInteractive = !options.passed.some(arg => arg === '-p' || arg === '--print')
  announceConnection(connection, options, isInteractive)
  return run('claude', [...[...folders, ...componentDirs].flatMap(dir => ['--plugin-dir', dir]), ...options.passed], {
    cwd: project,
    env: sessionEnvironment(connection, options, lessons, isInteractive, componentDirs),
  })
}

function learn(args) {
  const passed = []
  let lesson = null
  let isOnce = false
  for (let i = 0; i < args.length; i += 1) {
    const [flag] = split(args[i])
    if (args[i] === '--once') isOnce = true
    else if (args[i] === '--no-types') passed.push(args[i])
    else if (flag === '--dir') {
      const { value, end } = valueOf(args, i, 'a folder')
      passed.push('--dir', value)
      i = end
    } else if (!args[i].startsWith('-') && lesson === null) lesson = args[i]
    else throw new UsageError(`unknown option ${args[i]} for learn`)
  }
  if (lesson === null && passed.length + Number(isOnce) > 0) throw new UsageError('learn takes options only with a lesson')
  const watch = lesson !== null && !isOnce ? ['--watch'] : []
  // The checker works out the workspace itself, by the same rule, and says why it refuses one.
  const checker = [join(PACKAGE_ROOT, 'learn', 'check.mjs'), ...(lesson === null ? [] : [lesson]), ...passed, ...watch]
  return run(process.execPath, checker, { cwd: process.cwd() })
}

/** What `add` copies, by name: the templates and scratch-mod, which the marketplace leaves out to be copied. */
function addable() {
  const templates = join(PACKAGE_ROOT, 'templates')
  const sources = new Map(templateNames(templates).map(name => [name, join(templates, name)]))
  sources.set('scratch-mod', join(PACKAGE_ROOT, 'mods', 'scratch-mod'))
  return sources
}

function description(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).description ?? ''
  } catch {
    return ''
  }
}

async function add(args) {
  let name = null
  let to = null
  for (let i = 0; i < args.length; i += 1) {
    if (split(args[i])[0] === '--to') {
      const { value, end } = valueOf(args, i, 'a folder')
      to = resolve(value)
      i = end
    } else if (!args[i].startsWith('-') && name === null) name = args[i]
    else throw new UsageError(`unknown option ${args[i]} for add`)
  }
  const sources = addable()
  if (name === null) {
    const width = Math.max(...[...sources.keys()].map(one => one.length))
    console.log('What add copies (claude-mod-lab add <name>):\n')
    for (const [one, dir] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${one.padEnd(width)}  ${description(dir)}`)
    }
    return 0
  }
  const source = sources.get(name)
  if (source === undefined) {
    console.error(`No template is named ${name}. claude-mod-lab add, with no name, lists them.`)
    return 1
  }
  const workspace = to === null ? workspaceRoot() : null
  const dest = to ?? join(workspace, '.claude', 'skills', name)
  if (existsSync(dest)) {
    console.error(`${shown(dest)} is already there, so nothing was copied. Remove it, or copy elsewhere with --to <folder>.`)
    return 1
  }
  copyMod(source, dest)
  const isSkills = basename(dirname(dest)) === 'skills' && basename(dirname(dirname(dest))) === '.claude'
  console.log(`Copied ${name} to ${shown(dest)}/, yours to edit. Its tests: claude plugin test ${shown(dest)}`)
  console.log(
    isSkills
      ? `A session started in ${where(dirname(dirname(dirname(dest))))} loads it; in one already running there, /reload-plugins.`
      : basename(dirname(dest)) === 'workshop'
        ? `The lab started in ${where(dirname(dirname(dest)))} loads it from workshop/.`
        : `The lab loads the mods in a workspace's workshop/; on its own, claude --plugin-dir ${shown(dest)} loads it.`,
  )
  const { copies, problem } = await installedCopies([name], { cwd: workspace ?? process.cwd() })
  if (problem !== null) console.error(`Not checked for an installed copy of ${name}: ${problem}`)
  for (const copy of copies) {
    console.log(
      isSkills
        ? skillsCopyNote(copy)
        : `${name} is also installed (${copy.id}, ${copy.scope} scope); loaded with --plugin-dir, this copy takes precedence over it.`,
    )
  }
  return 0
}

const COMMANDS = { serve, run: startSession, attach: startSession, 'init-lessons': initLessons, learn, add }

async function main(argv) {
  const ours = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv
  const [command, ...rest] = argv
  if (command === '-v' || command === '--version') {
    console.log(version)
    return 0
  }
  if (ours.includes('-h') || ours.includes('--help')) {
    console.log(HELP)
    return 0
  }
  if (command === undefined || command.startsWith('-')) return serve(argv)
  if (Object.hasOwn(COMMANDS, command)) return COMMANDS[command](rest)
  throw new UsageError(`Unknown command ${command}. Use run ${JSON.stringify(command)} for an existing project, or init-lessons ${JSON.stringify(command)} to create a lesson workspace.`)
}

main(process.argv.slice(2)).then(
  status => (process.exitCode = status),
  error => {
    console.error(error instanceof Error ? error.message : error)
    if (error instanceof UsageError) console.error('claude-mod-lab --help lists the commands and options.')
    process.exitCode = error instanceof UsageError ? 2 : 1
  },
)
