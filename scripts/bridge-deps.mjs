// The npm dependency mod-lab-bridge carries for an installed copy: its own
// package.json names the claude-mod-lab package at the bridge's version, and a
// lockfile pins it. Claude Code installs a plugin's dependencies when the
// plugin is installed or updated (npm ci --ignore-scripts, in its copy of the
// plugin, and only where there is a lockfile), so an installed bridge finds
// the explorer's code in its node_modules (mods/mod-lab-bridge/explorer.mjs).
// A --plugin-dir copy installs nothing and finds the package another way.
//
// `npm run release` sets the version and drops a lockfile for another one;
// `npm run bridge-lock` writes the lockfile once that version is on npm.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const BRIDGE_DIR = 'mods/mod-lab-bridge'
export const PACKAGE = 'claude-mod-lab'

const manifest = (repo = REPO) => join(repo, BRIDGE_DIR, 'package.json')
const lockfile = (repo = REPO) => join(repo, BRIDGE_DIR, 'package-lock.json')

/** The claude-mod-lab version the bridge's package.json names, or null. */
export function bridgeDependency(repo = REPO) {
  return JSON.parse(readFileSync(manifest(repo), 'utf8')).dependencies?.[PACKAGE] ?? null
}

/** The claude-mod-lab version and integrity the bridge's lockfile pins, or null where there is no lockfile. */
export function bridgeLocked(repo = REPO) {
  if (!existsSync(lockfile(repo))) return null
  const entry = JSON.parse(readFileSync(lockfile(repo), 'utf8')).packages?.[`node_modules/${PACKAGE}`]
  return entry === undefined ? null : { version: entry.version, integrity: entry.integrity ?? null }
}

/**
 * Names `version` in the bridge's package.json, keeping the file's layout, and deletes a lockfile
 * that pins another: npm ci refuses a lockfile out of step with package.json, which would fail the
 * plugin's install, while no lockfile installs nothing and leaves the bridge without the explorer.
 */
export function setBridgeDependency(version, repo = REPO) {
  const text = readFileSync(manifest(repo), 'utf8')
  const pattern = new RegExp(`("${PACKAGE}"\\s*:\\s*")[^"]*(")`)
  if (!pattern.test(text)) throw new Error(`${BRIDGE_DIR}/package.json has no ${PACKAGE} dependency to set`)
  writeFileSync(manifest(repo), text.replace(pattern, `$1${version}$2`))
  const locked = bridgeLocked(repo)
  if (locked !== null && locked.version !== version) rmSync(lockfile(repo))
}
