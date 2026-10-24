// The Claude Code versions the lab supports, from its own copy of compat.json
// (the repository root's, copied by scripts/sync-compat.mjs): the check at
// session start, /mod-lab's line, and the capability table consulted before a
// feature runs. Below the floor the person is told to update; a feature the
// engine lacks is left out of the lists, and says it needs a newer version of
// Claude Code if asked for by name. testedThrough is a record for maintainers:
// nothing is said about a version past it.

import type { EngineInterface } from 'claude-code'

type Dollar = EngineInterface

/** What a feature or a plugin needs: the build that brought it, and the newer names it uses. */
export type Need = { since: string; uses: readonly string[] }

export type Compat = {
  floor: string
  testedThrough: string
  /** Plugins of this repository that need a newer build than the floor, by name: mod-lab-keys, and templates above it. */
  plugins: Readonly<Record<string, Need>>
  /** Features that call a noun or method newer than the floor, by what follows /mod-lab: a probe id or a command. */
  capabilities: Readonly<Record<string, Need>>
}

const VERSION = /^\d+\.\d+\.\d+$/
const MAX_TOLD = 20
/** The reason a feature the capability table keeps from running gives; a run with it was not run, rather than failed. */
export const NEEDS_NEWER = 'needs a newer version of Claude Code'

// Read at session.start, which runs again after a reload starts module variables over.
let known: { compat: Compat | null; version: string | null } = { compat: null, version: null }

/** Negative, zero or positive as `a` is older than, the same release as, or newer than `b`; a build's suffix (`-dev...`) is left out. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(version => (version.split('-')[0] ?? '').split('.').map(Number))
  for (let index = 0; index < Math.max(x?.length ?? 0, y?.length ?? 0); index += 1) {
    const step = (x?.[index] ?? 0) - (y?.[index] ?? 0)
    if (step !== 0) return step
  }
  return 0
}

function isNeed(value: unknown): value is Need {
  if (value === null || typeof value !== 'object') return false
  const { since, uses } = value as { since?: unknown; uses?: unknown }
  return typeof since === 'string' && VERSION.test(since) && Array.isArray(uses) && uses.every(name => typeof name === 'string')
}

function needsOf(table: unknown): Record<string, Need> {
  if (table === null || typeof table !== 'object') return {}
  return Object.fromEntries(Object.entries(table).filter(([, need]) => isNeed(need)))
}

/** compat.json's text as the lab uses it; null when it holds no floor and tested-through version. Entries of another shape are left out. */
export function parseCompat(text: string): Compat | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const { floor, testedThrough, plugins, capabilities } = data as Record<string, unknown>
  if (typeof floor !== 'string' || !VERSION.test(floor) || typeof testedThrough !== 'string' || !VERSION.test(testedThrough)) return null
  return { floor, testedThrough, plugins: needsOf(plugins), capabilities: needsOf(capabilities) }
}

/** What the person is told once per version below the floor; null at or above it. */
export function rangeNotice(version: string, compat: Compat): string | null {
  return compareVersions(version, compat.floor) < 0 ? 'mod-lab needs a newer version of Claude Code: update Claude Code to use it.' : null
}

/** At session.start: reads the version and compat.json, and below the floor tells the person, once per version, remembered in the store. */
export async function checkVersion($: Dollar): Promise<void> {
  const { version } = await $.session.version()
  known = { compat: null, version }
  const compat = parseCompat(await $.fs.read(`${$.plugin.root}/compat.json`))
  if (compat === null) throw new Error('its compat.json holds no floor and tested-through version')
  known = { compat, version }
  const notice = rangeNotice(version, compat)
  if (notice === null) return
  const stored = await $.store.get('versionsTold')
  const told = Array.isArray(stored) ? stored.filter(one => typeof one === 'string') : []
  if (told.includes(version)) return
  $.ui.log(notice)
  await $.store.set('versionsTold', [...told, version].slice(-MAX_TOLD))
}

const SURFACE_NAMES: Readonly<Record<string, string>> = { terminal: 'the terminal', desktop: 'the desktop app', vscode: 'VS Code', mobile: 'the mobile app' }

/** The surfaces in words: "in the terminal and the desktop app", or none attached, as in a -p run. */
export function surfacesText(surfaces: readonly string[]): string {
  if (surfaces.length === 0) return 'with no window attached'
  const names = surfaces.map(surface => SURFACE_NAMES[surface] ?? surface)
  return `in ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}`
}

/** /mod-lab's line, "mod-lab is running in the desktop app.", and below the floor a sentence on that. The version number is left to /mod-lab verify and the explorer. */
export async function engineLine($: Dollar): Promise<string> {
  let surfaces = ''
  try {
    surfaces = ` ${surfacesText(await $.session.surfaces())}`
  } catch {
    // Surfaces are left out of the line where the session does not answer them.
  }
  const head = `mod-lab is running${surfaces}.`
  if (known.compat === null || known.version === null) return head
  const notice = rangeNotice(known.version, known.compat)
  return notice === null ? head : `${head} ${notice}`
}

/** Whether the table names `name` with a version newer than the session's; false when either is not known. */
function isNewer(table: Readonly<Record<string, Need>> | undefined, name: string): boolean {
  const need = table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined
  return need !== undefined && known.version !== null && compareVersions(known.version, need.since) < 0
}

/** Whether the engine has what a feature (what follows /mod-lab: a probe id or a command) uses, by the capability table; true when the table or the version is not known. */
export function isAvailable(feature: string): boolean {
  return !isNewer(known.compat?.capabilities, feature)
}

/** Whether a plugin of this repository needs a newer version than the session runs; false when that is not known. */
export function isPluginMissing(name: string): boolean {
  return isNewer(known.compat?.plugins, name)
}
