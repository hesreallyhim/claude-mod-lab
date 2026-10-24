// Where the engine's declaration file is found, and in what order. An
// interactive session writes it beside each plugin it loads from a folder
// (--plugin-dir, .claude/skills/), never into an installed copy, and the
// plugin-authoring skill keeps a copy per Claude Code version under the temp
// folder. Neither the package nor the repository carries one.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

const LAID = ['.claude-plugin', 'types', 'claude-code', 'index.d.ts']

/** Where the plugin-authoring skill's copies are: /tmp/claude-<uid>, and the same under the temp folder where that differs. */
export const SKILL_BASES = [
  ...new Set([join('/tmp', `claude-${userInfo().uid}`), join(tmpdir(), `claude-${userInfo().uid}`)]),
]

/** How to get the declarations, for a message that found none. */
export const HOW_TO_GET =
  'An interactive session writes them beside each plugin it loads from a folder, never into an installed copy. ' +
  'To get them: start a session with npx claude-mod-lab run, load the plugin-authoring skill once in a session (/plugin-authoring), ' +
  'or set MOD_LAB_TYPES to a claude-code.d.ts.'

/** The version `claude --version` answers, or null where there is no claude to ask. */
export function claudeVersion() {
  try {
    const answer = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 })
    return /^(\d+\.\d+\.\d+\S*)/.exec(answer.trim())?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * The plugin-authoring skill's copy for one Claude Code version, the newest
 * where several builds of it left one, or null.
 *
 * @param {string} version
 * @param {string[]} [bases]
 */
export function skillCopy(version, bases = SKILL_BASES) {
  const found = []
  for (const base of bases) {
    const folder = join(base, 'bundled-skills', version)
    if (!existsSync(folder)) continue
    for (const build of readdirSync(folder)) {
      const path = join(folder, build, 'plugin-authoring', 'types', 'claude-code.d.ts')
      if (existsSync(path)) found.push({ path, mtime: statSync(path).mtimeMs })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)[0]?.path ?? null
}

/** The laid file in each folder of <workspace>/.claude/skills/, by the folder's name. */
function workspaceCopies(workspace) {
  const skills = join(workspace, '.claude', 'skills')
  if (!existsSync(skills)) return []
  return readdirSync(skills)
    .sort()
    .map(name => ({ path: join(skills, name, ...LAID), found: `in .claude/skills/${name}` }))
}

/**
 * @typedef {object} FoundTypes
 * @property {string | null} path the declaration file, or null
 * @property {string | null} found where it was found, in words: `MOD_LAB_TYPES`, `beside <root>` and so on
 * @property {string | null} version the Claude Code version the skill's copy was looked for at, when it came to that
 * @property {string[]} looked every place tried, in order
 */

/**
 * Finds the declaration file in this order: `explicit` (MOD_LAB_TYPES);
 * beside each of `roots`, the plugins the session loaded with mod-lab
 * first; laid in each folder of <workspace>/.claude/skills/; then the
 * plugin-authoring skill's copy for `version`, the session's Claude Code
 * version. Without `version` the skill's copy is the one for the version
 * `askVersion` answers, `claude --version` unless a test says otherwise.
 *
 * @param {{ explicit?: string, roots?: string[], workspace?: string, version?: string | null, bases?: string[], askVersion?: () => string | null }} options
 * @returns {FoundTypes}
 */
export function findTypes({
  explicit,
  roots = [],
  workspace,
  version,
  bases = SKILL_BASES,
  askVersion = claudeVersion,
}) {
  const named = [
    ...(explicit ? [{ path: explicit, found: 'MOD_LAB_TYPES' }] : []),
    ...roots.map(root => ({ path: join(root, ...LAID), found: `beside ${root}` })),
  ]
  const looked = named.map(step => step.path)
  if (workspace !== undefined) looked.push(join(workspace, '.claude', 'skills', '*', ...LAID))
  const hit = [...named, ...(workspace === undefined ? [] : workspaceCopies(workspace))].find(step =>
    existsSync(step.path),
  )
  if (hit !== undefined) return { path: hit.path, found: hit.found, version: null, looked }
  const wanted = version ?? askVersion()
  if (wanted === null) return { path: null, found: null, version: null, looked }
  looked.push(`the plugin-authoring skill's copy for ${wanted}, under ${bases.join(' or ')}`)
  const copy = skillCopy(wanted, bases)
  return copy === null
    ? { path: null, found: null, version: wanted, looked }
    : { path: copy, found: `the plugin-authoring skill's copy for ${wanted}`, version: wanted, looked }
}

/** What to say when no declaration file was found: for which version, and how to get one. */
export function missingTypes({ version }) {
  return `No engine declarations found${version === null ? '' : ` for Claude Code ${version}`}, so there is no reference; the probes still run. ${HOW_TO_GET}`
}
