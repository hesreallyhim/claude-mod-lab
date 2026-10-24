// The explorer's checks of a lesson as the person saves it. While a
// lesson's page is open its folder in the workshop is watched, and a save,
// once the folder has been quiet for a moment, runs the lesson checker
// (learn/check.mjs) on it; the checker records the result in the workspace's
// state, and the page is sent its report. Only that folder is watched, or
// workshop/ alone, for the folder to appear, while it is not there.
//
// Each session runs an explorer of its own, so two sessions in one workspace
// would check the same save twice: a lock in .claude-mod-lab/ lets one check
// at a time, and an explorer that finds it held waits, then takes the other's
// result from the state when it covers the save it was asked about.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'

import { readProgress } from './progress.mjs'
import { PACKAGE_ROOT, STATE_DIR } from './roots.mjs'

const runFile = promisify(execFile)

/** How long a folder stays quiet after a save before it is checked: an editor's save is often several writes. */
const QUIET_MS = 300
/** The checker's limit, and how much longer a lock is honoured: past that its holder is taken to have died. */
const CHECK_MS = 120_000
const STALE_MS = CHECK_MS + 10_000
const POLL_MS = 200

/** Saves the engine and editors make that are not the learner's edits: the declarations and tsconfig.json the engine writes into each mod it loads, and editors' swap files. */
export function isNoise(file) {
  return (
    file.includes(`.claude-plugin${sep}types`) ||
    basename(file) === 'tsconfig.json' ||
    basename(file) === '.DS_Store' ||
    /(~|\.swp|\.swx|^4913)$/.test(basename(file))
  )
}

/** The lesson checker's report on the lesson's folder in the workspace's workshop, as the lesson's page shows it; it exits 1 while a step fails. */
export async function runChecker(workspace, id) {
  try {
    const { stdout } = await runFile(
      process.execPath,
      [join(PACKAGE_ROOT, 'learn', 'check.mjs'), id, '--no-types', '--for-page'],
      {
        cwd: workspace,
        env: { ...process.env, MOD_LAB_WORKSPACE: workspace, NO_COLOR: '1' },
        timeout: CHECK_MS,
      },
    )
    return stdout
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout !== '') return error.stdout
    throw error
  }
}

/** A lesson's last check as the page shows it, without the report the state also keeps; null before its first. */
export function checkSummary(check) {
  return check === undefined || check === null ? null : { passed: check.passed, total: check.total, at: check.at }
}

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * The lock's holder: its process, its token, the lesson it checks and when it
 * took the lock. A lock just made and not yet written has no holder named.
 * Null when there is no lock.
 */
function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    const made = statSync(file, { throwIfNoEntry: false })
    return made === undefined ? null : { pid: null, token: null, lesson: null, at: made.mtimeMs }
  }
}

const isHeld = holder =>
  holder !== null && (holder.pid === null || isAlive(holder.pid)) && Date.now() - holder.at < STALE_MS

/** Takes the lock for a check of `lesson`: answers `mine` when this explorer has it, else the live holder's record. */
function takeLock(file, lesson) {
  mkdirSync(dirname(file), { recursive: true })
  for (;;) {
    const mine = { pid: process.pid, token: randomUUID(), lesson, at: Date.now() }
    try {
      writeFileSync(file, JSON.stringify(mine), { flag: 'wx' })
      return { mine, held: null }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const held = readLock(file)
    if (isHeld(held)) return { mine: null, held }
    // Left by a check that died, or gone since: try again.
    rmSync(file, { force: true })
  }
}

function releaseLock(file, mine) {
  if (readLock(file)?.token === mine.token) rmSync(file, { force: true })
}

/** Resolves once the holder has let go of the lock, or held it so long it is taken to have died. */
async function untilReleased(file, held) {
  for (;;) {
    const now = readLock(file)
    if (now?.token !== held.token || !isHeld(now)) return
    await new Promise(done => setTimeout(done, POLL_MS))
  }
}

/**
 * The checks of the workspace's lessons. `watch` keeps a lesson's folder
 * watched for its listener, until the function it answers is called; `poke`
 * asks for a check as a save does; `check` runs one now and answers it. Each
 * lesson's checks run one at a time, and a save during a check has the check
 * run again after it. A listener is sent `{ type: 'checking' }`, then
 * `{ type: 'checked', report, progress }` or `{ type: 'failed', error }`.
 *
 * @param {object} options
 * @param {string} options.workspace
 * @param {(id: string) => Promise<string>} [options.run] runs the checker on a lesson and answers its report
 * @param {number} [options.quietMs]
 */
export function createLessonChecks({ workspace, run = id => runChecker(workspace, id), quietMs = QUIET_MS }) {
  const workshop = join(workspace, 'workshop')
  const lockFile = join(workspace, STATE_DIR, 'check.lock')
  /** @type {Map<string, { lesson: { id: string, mod: string }, listeners: Set<Function>, watcher: import('node:fs').FSWatcher | null, timer: NodeJS.Timeout | undefined, asked: number, again: boolean, running: Promise<void> | null, last: object | null }>} */
  const entries = new Map()

  const entryOf = lesson => {
    if (!entries.has(lesson.id)) {
      entries.set(lesson.id, {
        lesson,
        listeners: new Set(),
        watcher: null,
        timer: undefined,
        asked: 0,
        again: false,
        running: null,
        last: null,
      })
    }
    return entries.get(lesson.id)
  }

  const emit = (entry, event) => {
    for (const listener of entry.listeners) listener(event)
  }

  /** The check, by this explorer or, when another holds the lock for the same lesson from after `since`, by that one. */
  async function checkShared(id, since) {
    for (;;) {
      const { mine, held } = takeLock(lockFile, id)
      if (mine !== null) {
        try {
          const report = await run(id)
          return { report, progress: checkSummary(readProgress(workspace).lessons[id]) }
        } finally {
          releaseLock(lockFile, mine)
        }
      }
      await untilReleased(lockFile, held)
      const recorded = readProgress(workspace).lessons[id]
      if (held.lesson === id && held.at >= since && recorded !== undefined) {
        return { report: recorded.report, progress: checkSummary(recorded) }
      }
    }
  }

  /** Runs the lesson's checks until no save asks for another, and answers when they are done. */
  function pass(entry) {
    if (entry.running !== null) {
      entry.again = true
      return entry.running
    }
    entry.running = (async () => {
      do {
        entry.again = false
        emit(entry, { type: 'checking' })
        try {
          entry.last = { type: 'checked', ...(await checkShared(entry.lesson.id, entry.asked)) }
        } catch (error) {
          entry.last = { type: 'failed', error: error instanceof Error ? error.message : String(error) }
        }
        emit(entry, entry.last)
      } while (entry.again)
    })().finally(() => (entry.running = null))
    return entry.running
  }

  function poke(entry) {
    entry.asked = Date.now()
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void pass(entry), quietMs)
  }

  /** Watches the lesson's folder, or workshop/ for the folder to appear; a folder that goes is waited for again. */
  function attach(entry) {
    entry.watcher?.close()
    const modDir = join(workshop, entry.lesson.mod)
    const isThere = existsSync(modDir)
    // Browsing a lesson must not initialize its workspace. init-lessons creates workshop/.
    if (!isThere && !existsSync(workshop)) return
    entry.watcher = isThere
      ? watch(modDir, { recursive: true }, (event, file) => {
          if (!existsSync(modDir)) attach(entry)
          else if (file !== null && isNoise(String(file))) return
          poke(entry)
        })
      : watch(workshop, (event, file) => {
          if (String(file) !== entry.lesson.mod || !existsSync(modDir)) return
          attach(entry)
          poke(entry)
        })
    entry.watcher.on('error', () => setTimeout(() => entry.listeners.size > 0 && attach(entry), quietMs))
  }

  return {
    /** Watches the lesson's folder for `listener` until the answered function is called. */
    watch(lesson, listener) {
      const entry = entryOf(lesson)
      entry.listeners.add(listener)
      if (entry.watcher === null) attach(entry)
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size > 0) return
        entry.watcher?.close()
        entry.watcher = null
        clearTimeout(entry.timer)
      }
    },

    /** Asks for a check of the lesson as a save of its folder does, after the same quiet. */
    poke(lesson) {
      poke(entryOf(lesson))
    },

    /** Checks the lesson now, after any check under way, and answers `{ report, progress }`; throws where the checker could not run. */
    async check(lesson) {
      const entry = entryOf(lesson)
      entry.asked = Date.now()
      clearTimeout(entry.timer)
      await pass(entry)
      if (entry.last.type === 'failed') throw new Error(entry.last.error)
      return { report: entry.last.report, progress: entry.last.progress }
    },

    close() {
      for (const entry of entries.values()) {
        entry.watcher?.close()
        entry.watcher = null
        clearTimeout(entry.timer)
      }
    },
  }
}
