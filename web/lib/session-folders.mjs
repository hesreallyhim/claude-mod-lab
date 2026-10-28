// The folders `npx claude-mod-lab` loads with --plugin-dir, in order: mod-lab,
// mod-lab-bridge and mod-lab-target, then any other plugin mod-lab names among
// its dependencies (mod-lab-keys), then the authoring skill plugins, then an explicitly selected lesson workspace's workshop/, a folder of
// plugins: each mod in it with a manifest loads, and in an interactive session
// one added later loads once its manifest exists. The first folder
// given sits on top of the hook chains, so the lab sees what everything
// beneath it does, and the target sits beneath the lab, where /mod-lab verify
// reads it.
//
// From an npm install the package's folders are loaded from copies in
// ~/.claude-mod-lab/plugins/<version>/, refreshed from the package on every
// start: the engine writes its declarations into the folders a session loads,
// and the copy keeps those writes out of the npm cache. A git checkout
// loads its own folders in place, so a contributor's edits to the lab
// hot-reload; the engine's files there are ignored by git.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { filesOf } from './components.mjs'
import { lessonPluginFolders } from './lesson-loading.mjs'

/** The lab, its bridge and its target, in the order they load. */
export const LAB = ['mod-lab', 'mod-lab-bridge', 'mod-lab-target']

/** Skill plugins included with every launcher session. */
export const AUTHORING_PLUGINS = ['mod-bootstrap']

function manifestOf(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * The lab's plugins in load order: LAB, then the other dependencies mod-lab
 * names that the package has. `missing` lists those it names and lacks; the
 * engine would not load mod-lab without them unless they are installed.
 *
 * @param {string} modsDir
 * @returns {{ names: string[], missing: string[] }}
 */
export function labPlugins(modsDir) {
  const dependencies = manifestOf(join(modsDir, 'mod-lab'))?.dependencies ?? []
  const named = dependencies
    .map(dependency => (typeof dependency === 'string' ? dependency : dependency?.name))
    .filter(name => typeof name === 'string')
    .map(name => name.split('@')[0])
    .filter(name => !LAB.includes(name))
  return {
    names: [...LAB, ...named.filter(name => existsSync(join(modsDir, name)))],
    missing: named.filter(name => !existsSync(join(modsDir, name))),
  }
}

/**
 * How the package at `packageRoot` is loaded: its version, which names the
 * copies' folder, and whether it is a git checkout, loaded in place.
 *
 * @param {string} packageRoot
 * @returns {{ version: string, inPlace: boolean }}
 */
export function packageFacts(packageRoot) {
  const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return { version, inPlace: existsSync(join(packageRoot, '.git')) }
}

const copiesRoot = (home, version) => join(home, '.claude-mod-lab', 'plugins', version)

/**
 * The lab's folders as the launcher loads them, with nothing written: where an
 * interactive session lays the engine's declarations, and so where the
 * explorer can look for them before a session connects.
 *
 * @param {{ packageRoot: string, home: string, version: string, inPlace: boolean }} options
 */
export function labFolders({ packageRoot, home, version, inPlace }) {
  const base = inPlace ? join(packageRoot, 'mods') : copiesRoot(home, version)
  return labPlugins(join(packageRoot, 'mods')).names.map(name => join(base, name))
}

/**
 * Brings `to` in line with the mod in `from`: files the package has are
 * copied where they differ, files it no longer has are deleted, and the
 * engine's own files (its declarations, its tsconfig.json) stay. A file that
 * is already the same is not written, so a session running from the copy is
 * not made to reload.
 */
export function refreshCopy(from, to) {
  mkdirSync(to, { recursive: true })
  const wanted = filesOf(from)
  const kept = new Set(wanted)
  for (const path of filesOf(to)) if (!kept.has(path)) rmSync(join(to, path))
  for (const path of wanted) {
    const source = join(from, path)
    const target = join(to, path)
    if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
}

/**
 * The --plugin-dir folders for a session, in order: the lab's, with their
 * copies refreshed first unless `inPlace`, then the authoring skills and the selected lesson workspace's workshop/, if any.
 * `names` includes the lab and authoring plugins.
 *
 * @param {object} options
 * @param {string} options.packageRoot
 * @param {string} options.home the folder ~/.claude-mod-lab/ is in
 * @param {string} options.version the package's version, which names the copies' folder
 * @param {boolean} options.inPlace load the package's own folders, as in a git checkout
 * @param {string | null} [options.workspace] an initialized lesson folder whose workshop/ loads beneath the lab
 * @returns {{ folders: string[], names: string[], copyRoot: string | null, missing: string[] }}
 */
export function sessionFolders({ packageRoot, home, version, inPlace, workspace = null }) {
  const modsDir = join(packageRoot, 'mods')
  const { names: mods, missing } = labPlugins(modsDir)
  const sources = mods.map(name => ({ name, dir: join(modsDir, name) }))
  for (const name of AUTHORING_PLUGINS) {
    const dir = join(packageRoot, 'plugins', name)
    if (manifestOf(dir)?.name === name) sources.push({ name, dir })
    else missing.push(name)
  }
  const names = sources.map(({ name }) => name)
  const copyRoot = inPlace ? null : copiesRoot(home, version)
  const lab = sources.map(({ name, dir }) => {
    if (copyRoot === null) return dir
    refreshCopy(dir, join(copyRoot, name))
    return join(copyRoot, name)
  })
  return { folders: [...lab, ...(workspace === null ? [] : lessonPluginFolders(workspace))], names, copyRoot, missing }
}
