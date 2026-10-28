// Explicit component loading uses one collection for new copies. Copies made
// by older versions stay where the user may already be editing them.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { exampleNames } from './sandbox.mjs'

export const componentFolder = project => join(project, '.claude', 'mod-lab')
export const sharedComponentFolder = (home = homedir()) => join(home, '.claude-mod-lab', 'examples')

function isComponent(dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name === name
  } catch {
    return false
  }
}

/** Known lab copies only: unrelated project skills and plugins are not explicitly loaded. */
export function legacyComponentFolders(project, packageRoot) {
  const names = [...exampleNames(join(packageRoot, 'examples')), 'gallery-mod']
  return names
    .filter(name => !existsSync(join(componentFolder(project), name)))
    .map(name => ({ name, dir: join(project, '.claude', 'skills', name) }))
    .filter(({ name, dir }) => isComponent(dir, name))
    .map(({ dir }) => dir)
}
