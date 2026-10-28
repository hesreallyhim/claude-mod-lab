// The Explorer and in-session commands share the same two destinations.
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { componentFolder, sharedComponentFolder } from './component-folders.mjs'
import { createComponents } from './components.mjs'

/** Select a collection without creating directories or overwriting existing copies. */
export function exampleCollection(packageRoot, project, scope, home = homedir()) {
  if (scope !== 'shared' && scope !== 'local') throw new Error('Choose shared or local examples.')
  if (typeof project !== 'string' || !isAbsolute(project) || !statSync(project).isDirectory()) {
    throw new Error('Examples need an existing project directory with an absolute path.')
  }
  if (scope === 'local' && realpathSync(project) === realpathSync(home)) {
    throw new Error('Choose a project directory other than your home folder for local examples.')
  }
  return createComponents({
    examplesDir: join(packageRoot, 'examples'),
    skillsDir: scope === 'local' ? componentFolder(project) : sharedComponentFolder(home),
    legacyDir: scope === 'local' ? join(project, '.claude', 'skills') : null,
    others: { 'gallery-mod': join(packageRoot, 'mods', 'gallery-mod') },
  })
}
