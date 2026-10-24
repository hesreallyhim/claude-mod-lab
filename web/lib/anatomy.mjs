// The anatomy of the mods on this machine: what `claude plugin validate`
// reads in each hooks module (its hooks, its calls on $, its gating hooks,
// its state). Installed plugins come from `claude plugin list --json`; the
// package's own mods/ and the workspace's workshop/ are read from disk.

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { readValidation } from '../../learn/lib/lessons.mjs'

const run = promisify(execFile)
const PARALLEL = 4

async function claude(args) {
  try {
    const { stdout } = await run('claude', args, { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 })
    return stdout
  } catch (error) {
    // validate exits 1 on a refusal and still prints its report.
    if (typeof error.stdout === 'string' && error.stdout !== '') return error.stdout
    throw error
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Whether a plugin folder holds a hooks module: hooks/hooks.json naming one under `modules`. */
export function isMod(path) {
  const hooks = readJson(join(path, 'hooks', 'hooks.json'))
  return Array.isArray(hooks?.modules) && hooks.modules.length > 0
}

/** Folders under `dir` that hold a plugin manifest, as mods of `source`. */
function foldersIn(dir, source) {
  if (dir === null || !existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, '.claude-plugin', 'plugin.json')))
    .map(entry => ({
      id: entry.name,
      name: entry.name,
      source,
      path: join(dir, entry.name),
      enabled: null,
      version: readJson(join(dir, entry.name, '.claude-plugin', 'plugin.json'))?.version ?? null,
    }))
}

/** Every plugin to look at: installed ones, then those in `modsDir` and in `workshopDir`. */
export async function listPlugins(modsDir, workshopDir, { list = () => claude(['plugin', 'list', '--json']) } = {}) {
  let installed = []
  try {
    installed = JSON.parse(await list()).map(plugin => ({
      id: plugin.id,
      name: String(plugin.id).split('@')[0],
      source: 'installed',
      path: plugin.installPath,
      enabled: plugin.enabled === true,
      version: plugin.version ?? null,
    }))
  } catch {
    // No CLI on the path, or output it could not read: the folders on disk still count.
  }
  return [...installed, ...foldersIn(modsDir, 'repo'), ...foldersIn(workshopDir, 'workshop')]
}

async function anatomyOf(plugin, validate) {
  if (!existsSync(plugin.path) || !isMod(plugin.path)) return { ...plugin, isMod: false, validation: null }
  try {
    const report = JSON.parse(await validate(plugin.path))
    const name = readJson(join(plugin.path, '.claude-plugin', 'plugin.json'))?.name ?? plugin.name
    return { ...plugin, isMod: true, validation: readValidation(report, name) }
  } catch (error) {
    return { ...plugin, isMod: true, validation: null, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The anatomy of each plugin that is a mod, the rest listed as plugins without a hooks module.
 * `modsDir` is the package's mods/, `workshopDir` the workspace's workshop/.
 * `list` and `validate` stand in for `claude plugin list` and `claude plugin validate`.
 *
 * @param {string} modsDir
 * @param {string} workshopDir
 * @param {{ list?: () => Promise<string>, validate?: (path: string) => Promise<string> }} [options]
 */
export async function readAnatomy(
  modsDir,
  workshopDir,
  { list, validate = path => claude(['plugin', 'validate', '--json', path]) } = {},
) {
  const plugins = await listPlugins(modsDir, workshopDir, { list })
  const results = []
  for (let index = 0; index < plugins.length; index += PARALLEL) {
    results.push(
      ...(await Promise.all(plugins.slice(index, index + PARALLEL).map(plugin => anatomyOf(plugin, validate)))),
    )
  }
  return results
}
