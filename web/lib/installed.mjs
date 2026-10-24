// Installed copies of a plugin, as `claude plugin list --json` reports them for
// a folder. Of several copies of one name the engine loads one: a --plugin-dir
// copy over an installed one, and an installed one over a copy in the project's
// .claude/skills/, which then does not load. `claude-mod-lab add` and the
// launcher, and the explorer's Add to session, check here and say what that
// means for the copy they made or load.
// In a folder the person has trusted, the list also names each copy in the
// project's .claude/skills/, as `<name>@skills-dir`: those are the copies
// `add` makes, not installed ones, and are left out.
//
// The same list, asked for with --plugin-dir, also says whether managed
// settings forbid that flag (disableSideloadFlags), which the launcher needs.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

/** The end of the id `claude plugin list` gives a copy in the project's .claude/skills/. */
const SKILLS_DIR = '@skills-dir'

/** `claude plugin list --json` in `cwd`, which decides what counts as enabled there, after the options given. */
async function listPlugins(cwd, options = []) {
  const { stdout } = await runFile('claude', [...options, 'plugin', 'list', '--json'], {
    cwd,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

/**
 * Claude Code's refusal, in its own words, when managed settings forbid
 * --plugin-dir (disableSideloadFlags); null when they do not, or it could
 * not be asked. Claude Code checks the flag before any command runs, the
 * plugin list included, and exits with that message.
 *
 * @param {string} dir a folder to name with --plugin-dir
 * @param {{ cwd: string, list?: (cwd: string, options: string[]) => Promise<string> }} options
 * @returns {Promise<string | null>}
 */
export async function sideloadRefusal(dir, { cwd, list = listPlugins }) {
  try {
    await list(cwd, ['--plugin-dir', dir])
    return null
  } catch (error) {
    const said = `${error?.stderr ?? ''}${error?.stdout ?? ''}`.trim()
    return said.includes('disableSideloadFlags') ? said : null
  }
}

/**
 * The installed copies of the plugins named that are enabled in `cwd`. Where
 * claude could not be asked, or it suppressed project plugins, the reason is
 * retained in problem rather than treating an empty list as permission to load.
 *
 * @param {string[]} names
 * @param {{ cwd: string, list?: (cwd: string) => Promise<string> }} options
 * @returns {Promise<{ copies: { id: string, name: string, scope: string }[], problem: string | null }>}
 */
export async function installedCopies(names, { cwd, list = listPlugins }) {
  let entries
  try {
    entries = JSON.parse(await list(cwd))
  } catch (error) {
    return {
      copies: [],
      problem: `claude plugin list did not answer: ${error instanceof Error ? error.message : error}`,
    }
  }
  if (!Array.isArray(entries)) return { copies: [], problem: 'claude plugin list returned an unexpected response.' }
  const copies = entries
    .filter(entry => entry?.enabled === true && typeof entry.id === 'string' && !entry.id.endsWith(SKILLS_DIR))
    .map(entry => ({ id: entry.id, name: entry.id.split('@')[0], scope: String(entry.scope ?? 'unknown') }))
    .filter(copy => names.includes(copy.name))
  const suppressed = entries.filter(entry => entry?.id === '(suppressed)@skills-dir')
  const notes = suppressed
    .flatMap(entry => (Array.isArray(entry.notes) ? entry.notes : []))
    .filter(note => typeof note === 'string')
  const problem =
    suppressed.length === 0 ? null : notes.join('\n') || 'Claude Code skipped project plugins in this workspace.'
  return { copies, problem }
}

/** For a copy in .claude/skills/: the installed one keeps it from loading, and how to turn that off for this folder alone. */
export function skillsCopyNote(copy) {
  return (
    `${copy.name} is also installed (${copy.id}, ${copy.scope} scope), and an installed copy takes precedence ` +
    `over one in .claude/skills/, which then does not load. To use the copy here, disable the installed one ` +
    `for this folder alone: claude plugin disable ${copy.id} --scope local, then /reload-plugins in the session.`
  )
}

/** For a copy loaded with --plugin-dir: it takes precedence over the installed one, and has a store of its own. */
export function sessionCopyNote(copy) {
  return (
    `${copy.name} is also installed (${copy.id}, ${copy.scope} scope). This session loads its own copy, ` +
    'which takes precedence, with a store of its own: what the installed copy saved is not seen here.'
  )
}
