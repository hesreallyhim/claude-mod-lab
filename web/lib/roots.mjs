// The two roots the explorer and the checker work from. The package root is
// where this code is installed, and is only read: web/, learn/, templates/,
// mods/ and the docs. The workspace is the person's own folder, for what they
// make: workshop/, .claude/skills/, the Sandbox and lesson progress. A clone
// supplies the package; lessons normally use a separate initialized workspace.
//
// A workspace is marked by its .claude-mod-lab/ folder, which holds the lab's
// state for it. `npx claude-mod-lab init-lessons <folder>` explicitly creates one.

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The package root: the folder holding web/, two up from this file. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The folder that makes a folder a workspace, and holds the lab's state for it. */
export const STATE_DIR = '.claude-mod-lab'

// What a folder may hold and still count as empty, to be made a workspace: a fresh `git init`, and Finder's file.
const EMPTY_ENOUGH = new Set(['.git', '.DS_Store'])

const README = `# claude-mod-lab workspace

A workspace of [claude-mod-lab](https://github.com/hesreallyhim/claude-mod-lab), a playground for learning Claude Code mods. Run \`npx claude-mod-lab run\` here to start Claude Code with the lab and open the explorer.

Your mods go in \`workshop/\`, one folder each, and the lab loads every one of them. \`.claude-mod-lab/\` holds the lab's state for this folder.

Starting a lesson also copies its finished source to \`solutions/<lesson-id>/\` for reference. These copies have no plugin manifest and are not loaded by the session; edit your working mod in \`workshop/\`.
`

const GITIGNORE = `# The lab's state for this workspace.
.claude-mod-lab/
# Claude Code's settings for this folder alone, where the explorer's Workshop page turns mods off.
.claude/settings.local.json
# What Claude Code writes into each mod it loads: the declarations, and a tsconfig.json that extends them. The mods themselves are yours to keep.
workshop/*/.claude-plugin/types/
workshop/*/tsconfig.json
# The lab, where npx claude-mod-lab init-lessons . --pin installs it.
node_modules/
`

/** A path with its symlinks resolved, where it exists. */
const real = path => (existsSync(path) ? realpathSync(path) : resolve(path))

const isFolder = path => existsSync(path) && statSync(path).isDirectory()

/** Whether `dir` is a workspace: it holds .claude-mod-lab/. */
export const isWorkspace = dir => isFolder(join(dir, STATE_DIR))

function refuseHome(dir, home, hint) {
  if (real(dir) !== real(home)) return
  throw new Error(
    `The workspace cannot be your home folder (${dir}): Claude Code loads its .claude/skills/ into every session. ${hint}`,
  )
}

/**
 * The workspace, as a real path: MOD_LAB_WORKSPACE (relative to `cwd` when
 * relative), else `cwd`. Refused, with a message saying how to choose one,
 * when it is the home folder, whose .claude/skills/ loads into every session,
 * or not a folder.
 *
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, home?: string }} [options]
 * @returns {string}
 */
export function workspaceRoot({ env = process.env, cwd = process.cwd(), home = homedir() } = {}) {
  const named = env.MOD_LAB_WORKSPACE
  const workspace = resolve(cwd, named || '.')
  if (named && !isFolder(workspace)) {
    throw new Error(`MOD_LAB_WORKSPACE names ${workspace}, which is not a folder: make it, or set the variable to one.`)
  }
  refuseHome(workspace, home, 'Run from a folder of your own, or set MOD_LAB_WORKSPACE to one.')
  return real(workspace)
}

/**
 * The folder the lab starts in: `folder` (relative to `cwd`) when given, else
 * `cwd`. A workspace is taken as it is; a folder that is missing or empty is
 * to be made one (`isNew`). Anything else is refused, with a message saying
 * what to do, as is the home folder.
 *
 * @param {{ folder?: string, cwd?: string, home?: string }} options
 * @returns {{ dir: string, isNew: boolean }}
 */
export function labFolder({ folder, cwd = process.cwd(), home = homedir() }) {
  const dir = resolve(cwd, folder ?? '.')
  refuseHome(dir, home, 'Name a lesson folder of your own: npx claude-mod-lab init-lessons my-lab.')
  if (!existsSync(dir)) return { dir, isNew: true }
  if (!isFolder(dir)) throw new Error(`${dir} is a file. Name a new folder for the lab, or an empty one.`)
  if (isWorkspace(dir)) return { dir: real(dir), isNew: false }
  if (readdirSync(dir).every(name => EMPTY_ENOUGH.has(name))) return { dir: real(dir), isNew: true }
  throw new Error(
    folder === undefined
      ? 'This folder is not a claude-mod-lab workspace, and not empty. Name a new folder for the lab, as in npx claude-mod-lab init-lessons my-lab, or run it in an empty one.'
      : `${dir} is not a claude-mod-lab workspace, and not empty. Name a new folder for the lab, or an empty one.`,
  )
}

/**
 * Makes `dir` a workspace, creating it if need be: .claude-mod-lab/,
 * workshop/, and a README.md and .gitignore where it has none. Answers its
 * real path.
 *
 * @param {string} dir
 * @returns {string}
 */
export function makeWorkspace(dir) {
  mkdirSync(join(dir, STATE_DIR), { recursive: true })
  mkdirSync(join(dir, 'workshop'), { recursive: true })
  for (const [name, text] of [
    ['README.md', README],
    ['.gitignore', GITIGNORE],
  ]) {
    if (!existsSync(join(dir, name))) writeFileSync(join(dir, name), text)
  }
  return realpathSync(dir)
}

/** @param {string} dir @param {{ home?: string }} [options] */
export function initializeProjectLessons(dir, { home = homedir() } = {}) {
  refuseHome(dir, home, 'Open a project folder before running /init-lessons.')
  if (!isFolder(dir)) throw new Error(`${dir} is not an existing project folder.`)
  const project = realpathSync(dir)
  if (project === realpathSync(PACKAGE_ROOT)) {
    throw new Error('Open a separate project for lessons; the claude-mod-lab package folder is not a lesson workspace.')
  }
  const folders = [STATE_DIR, 'workshop'].map(name => join(project, name))
  for (const folder of folders) {
    const stat = lstatSync(folder, { throwIfNoEntry: false })
    if (stat !== undefined && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`${folder} must be a directory, not a file or symbolic link. No lesson folders were created.`)
    }
  }
  for (const folder of folders) mkdirSync(folder, { recursive: true })
  return project
}
