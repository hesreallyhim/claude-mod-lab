// mod-lab-bridge: connects the mod-lab explorer page to this session. The
// explorer is this session's own, served by the plugin's MCP server
// (../explorer.mjs); or one started on its own with claude-mod-lab serve,
// found through the shared bridge file, where the session's own is not open;
// or the one an override names.
// What it sends, when it connects and how to run it are in ../README.md and
// in ../../../docs/design.md under "Bridge protocol".

import type { EngineInterface, Register } from 'claude-code'

import type { Connection, Endpoint, Job } from './bridge'
import {
  expandHome,
  hello,
  poll,
  PROTOCOL,
  readEndpoint,
  sendAnswer,
  sendMirror,
  sendRuns,
  sendTaps,
  sendTraces,
  sessionEndpoint,
  SHARED_FILE,
} from './bridge'

type Dollar = EngineInterface

const POLL_MS = 400
// While no explorer is connected it is looked for every eighth tick.
const IDLE_TICKS = 8
const COMMAND_TICKS = 8

// Module variables start over on a reload; session.start starts the loop again.
// The bridgeFile option as given; the override's bridge file once read, null when there is none.
let option: string | null = null
let override: string | null | undefined
let link: Connection | null = null
let ticking = false
let idleTicks = 0
let sentRun = 0
let sentTrace = 0
let sentTap = 0
let commandTicks = 0
type LessonSelection = { lessons: string | null; lessonCollection: string | null }
let sentLessons: LessonSelection = { lessons: null, lessonCollection: null }
// The lab's state values the explorer mirrors, and each as last sent, as JSON, so it is sent again only when it changed.
const MIRRORED = ['intercepts', 'spend', 'agents', 'rows', 'compactor', 'keys', 'config'] as const
let sentMirror = new Map<string, string>()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function probesOf($: Dollar): Promise<readonly unknown[]> {
  try {
    return await $.lab.probes()
  } catch {
    return []
  }
}

async function interceptableOf($: Dollar): Promise<readonly string[]> {
  try {
    return await $.lab.interceptable()
  } catch {
    return []
  }
}

/** mod-lab's folder; null from a lab that does not answer it. */
async function labRootOf($: Dollar): Promise<string | null> {
  try {
    return await $.lab.root()
  } catch {
    return null
  }
}

/** What the session draws on now; none in a -p run. */
async function surfacesOf($: Dollar): Promise<readonly string[]> {
  try {
    return await $.session.surfaces()
  } catch {
    return []
  }
}

/** Collection and legacy plugin paths explicitly passed by the lab launcher on macOS/Linux. */
async function componentDirsOf($: Dollar): Promise<string[]> {
  try {
    const paths: unknown = JSON.parse((await $.env.get('MOD_LAB_COMPONENT_DIRS')) || '[]')
    return Array.isArray(paths)
      ? paths.filter((path): path is string => typeof path === 'string' && path.startsWith('/') && !path.includes('\0'))
      : []
  } catch {
    return []
  }
}

async function lessonSelection($: Dollar): Promise<LessonSelection> {
  return {
    lessons: (await $.env.get('MOD_LAB_LESSONS')) || null,
    lessonCollection: (await $.env.get('MOD_LAB_LESSON_COLLECTION')) || null,
  }
}

async function greeting($: Dollar, selected?: LessonSelection) {
  const { version } = await $.session.version()
  return {
    protocol: PROTOCOL,
    plugin: { name: $.plugin.name, root: $.plugin.root },
    // The explorer looks for the engine's declarations beside mod-lab first, then beside the bridge.
    lab: {
      root: await labRootOf($),
      ...(selected ?? (await lessonSelection($))),
      componentDirs: await componentDirsOf($),
      examplesDir: (await $.env.get('MOD_LAB_EXAMPLES_DIR')) || null,
    },
    session: {
      id: await $.session.id(),
      cwd: await $.session.cwd(),
      model: await $.session.model(),
      version,
    },
    // The engine version and attached clients help identify the session in bug reports.
    engine: { version, surfaces: await surfacesOf($) },
    probes: await probesOf($),
    interceptable: await interceptableOf($),
  }
}

/** The override: the bridgeFile option, else MOD_LAB_BRIDGE_FILE, with ~ expanded; null when neither is set. */
async function overrideOf($: Dollar): Promise<string | null> {
  const given = option ?? (await $.env.get('MOD_LAB_BRIDGE_FILE'))
  return given === undefined || given === '' ? null : expandHome($, given)
}

/** Links this session to an explorer, and says where it is on the status line. */
function linkTo($: Dollar, connection: Connection, selected: LessonSelection): void {
  link = connection
  sentLessons = { lessons: selected.lessons, lessonCollection: selected.lessonCollection }
  sentRun = 0
  sentTrace = 0
  sentTap = 0
  commandTicks = 0
  sentMirror = new Map()
  // The page's address as the person opens it: the explorer listens on 127.0.0.1, and its pages use localhost.
  $.ui.status(`explorer: ${link.url.replace(/^http:\/\/127\.0\.0\.1\b/, 'http://localhost')}`)
}

/** This session's explorer where it serves now; null where it does not yet, or its server is not up. */
async function ownNow($: Dollar): Promise<Endpoint | null> {
  try {
    return await sessionEndpoint($, 0)
  } catch {
    return null
  }
}

/**
 * Connects to the explorer, in this order: the one an override names (the e2e
 * tests, the screenshot script, development); this session's own, where the
 * launcher asked it to open (MOD_LAB_OPEN) or it already serves; the one
 * claude-mod-lab serve started on its own, through the shared bridge file,
 * where it answers; else this session's own, waited for while it starts.
 */
async function connect($: Dollar): Promise<void> {
  if (override === undefined) override = await overrideOf($)
  const greet = await greeting($)
  if (override !== null) {
    const named = await readEndpoint($, override)
    if (named !== null) linkTo($, await hello($, named, greet), greet.lab)
    return
  }
  if ((await $.env.get('MOD_LAB_OPEN')) !== '1') {
    const own = await ownNow($)
    if (own !== null) {
      linkTo($, await hello($, own, greet), greet.lab)
      return
    }
    const shared = await readEndpoint($, await expandHome($, SHARED_FILE))
    if (shared !== null) {
      try {
        linkTo($, await hello($, shared, greet), greet.lab)
        return
      } catch {
        // Nothing answers behind the file, left by an explorer that has stopped: this session's own, then.
      }
    }
  }
  const endpoint = await sessionEndpoint($)
  if (endpoint !== null) linkTo($, await hello($, endpoint, greet), greet.lab)
}

async function refreshLessons($: Dollar, connection: Connection): Promise<Connection> {
  const selected = await lessonSelection($)
  if (selected.lessons === sentLessons.lessons && selected.lessonCollection === sentLessons.lessonCollection) return connection
  const refreshed = await hello($, connection, await greeting($, selected))
  sentLessons = selected
  connection.client = refreshed.client
  return connection
}

/** Asks the lab to do what `/mod-lab <text>` does, inside the lab's own hook, and answers its text. */
async function commandJob($: Dollar, connection: Connection, id: string, text: string): Promise<void> {
  let answer: string
  try {
    answer = await $.lab.command({ text, from: 'explorer' })
  } catch (error) {
    answer = `the lab did not answer: ${messageOf(error)}`
  }
  await sendAnswer($, connection, id, answer)
}

/**
 * Runs /reload-plugins and answers its text. The tick runs on a timer, not
 * in a hook the turn waits on, which is where $.command.run is let through.
 * The command waits for the session to be idle, so the tick does not wait on
 * it: a turn, or /mod-lab explorer serve, would hold the polling until it ended.
 */
async function reloadJob($: Dollar, connection: Connection, id: string): Promise<void> {
  let answer: string
  try {
    answer = (await $.command.run({ command: 'reload-plugins' })).text ?? 'reloaded'
  } catch (error) {
    answer = `the session did not reload: ${messageOf(error)}`
  }
  await forwardCommands($, connection)
  await sendAnswer($, connection, id, answer)
}

/** Asks the lab to run a job; `$.lab.run` happens inside the lab's own hook, so its dispatches are recorded. */
async function runJob($: Dollar, connection: Connection, job: Job): Promise<void> {
  if (job.kind === 'command') return commandJob($, connection, job.id, job.text)
  if (job.kind === 'reload') {
    void reloadJob($, connection, job.id).catch(() => undefined)
    return
  }
  let run: unknown
  try {
    run = await $.lab.run({ probe: job.probe, args: job.args, from: 'explorer' })
  } catch (error) {
    run = { seq: 0, probe: job.probe, ok: false, error: `the lab did not run it: ${messageOf(error)}`, dispatches: [] }
  }
  await sendRuns($, connection, [run], job.id)
}

/** A mirrored value of the lab's state. Each key is spelled out: $.state.get takes literals, so the validator can list what a module reads. */
async function mirroredValue($: Dollar, key: (typeof MIRRORED)[number]): Promise<unknown> {
  switch (key) {
    case 'intercepts':
      return (await $.state.get({ plugin: 'mod-lab', key: 'intercepts' })).value
    case 'spend':
      return (await $.state.get({ plugin: 'mod-lab', key: 'spend' })).value
    case 'agents':
      return (await $.state.get({ plugin: 'mod-lab', key: 'agents' })).value
    case 'rows':
      return (await $.state.get({ plugin: 'mod-lab', key: 'rows' })).value
    case 'compactor':
      return (await $.state.get({ plugin: 'mod-lab', key: 'compactor' })).value
    case 'keys':
      return (await $.state.get({ plugin: 'mod-lab', key: 'keys' })).value
    case 'config':
      return (await $.state.get({ plugin: 'mod-lab', key: 'config' })).value
  }
}

/** Current command registrations, with unknown availability distinct from an empty list. */
async function commandsOf($: Dollar): Promise<{ name: string; plugin: string | null }[] | null> {
  try {
    return (await $.command.list()).map(command => ({
      name: command.name,
      plugin: command.source === 'plugin' ? command.plugin ?? null : null,
    }))
  } catch {
    return null
  }
}

/** Mirror actual command availability separately from copied files or a completed reload. */
async function forwardCommands($: Dollar, connection: Connection): Promise<void> {
  const commands = await commandsOf($)
  const sent = JSON.stringify(commands)
  if (sent === sentMirror.get('commands')) return
  await sendMirror($, connection, 'commands', commands)
  sentMirror.set('commands', sent)
}

/** Sends the lab's runs, trace rows and taps that the explorer has not had yet, and each mirrored value when it changed. */
async function forward($: Dollar, connection: Connection): Promise<void> {
  const { value: runs = [] } = await $.state.get({ plugin: 'mod-lab', key: 'runs' })
  const freshRuns = runs.filter(run => run.seq > sentRun)
  if (freshRuns.length > 0) {
    await sendRuns($, connection, freshRuns, null)
    sentRun = freshRuns.at(-1)?.seq ?? sentRun
  }
  const { value: rows = [] } = await $.state.get({ plugin: 'mod-lab', key: 'traces' })
  const freshRows = rows.filter(row => row.seq > sentTrace)
  if (freshRows.length > 0) {
    await sendTraces($, connection, freshRows)
    sentTrace = freshRows.at(-1)?.seq ?? sentTrace
  }
  const { value: taps = [] } = await $.state.get({ plugin: 'mod-lab', key: 'taps' })
  const freshTaps = taps.filter(tap => tap.seq > sentTap)
  if (freshTaps.length > 0) {
    await sendTaps($, connection, freshTaps)
    sentTap = freshTaps.at(-1)?.seq ?? sentTap
  }
  for (const key of MIRRORED) {
    const value = await mirroredValue($, key)
    const sent = JSON.stringify(value ?? null)
    if (value !== undefined && sent !== sentMirror.get(key)) {
      await sendMirror($, connection, key, value)
      sentMirror.set(key, sent)
    }
  }
}

async function tick($: Dollar): Promise<void> {
  if (link === null) {
    if (idleTicks++ % IDLE_TICKS === 0) await connect($)
    return
  }
  const refresh = commandTicks++ % COMMAND_TICKS === 0
  if (refresh) link = await refreshLessons($, link)
  const job = await poll($, link)
  if (job !== null) await runJob($, link, job)
  await forward($, link)
  if (refresh) await forwardCommands($, link)
}

function dropLink($: Dollar): void {
  link = null
  // The next attempt waits a full idle interval, so a refusing server is not asked every tick.
  idleTicks = 1
  $.ui.status(undefined)
}

function startLoop($: Dollar): void {
  $.clock.every(POLL_MS, () => {
    if (ticking) return
    ticking = true
    void tick($)
      .catch(() => dropLink($))
      .finally(() => {
        ticking = false
      })
  })
}

export const register: Register = (on, options) => {
  if (typeof options.bridgeFile === 'string' && options.bridgeFile !== '') option = options.bridgeFile

  on('session.start', async ($, e, next) => {
    startLoop($)
    return next(e)
  })
}
