// Type-checks each mod, each lesson's solution with its checks, and each
// challenge's starter, against the engine's declarations. The engine lays a
// tsconfig in a mod's folder once it has loaded the mod from a folder it
// watches; before that, and in CI, scripts/tsc.mjs writes one to a temp folder.
// Given folders (node scripts/typecheck.mjs workshop/stopwatch), it checks those mods alone.

import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadLessons } from '../learn/lib/lessons.mjs'
import { findTypes } from '../web/lib/types-path.mjs'
import { declarationFiles, dependencyContracts, typecheck } from './tsc.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MODS = {
  'mod-lab': ['mod-lab-keys'],
  'mod-lab-bridge': ['mod-lab'],
  'mod-lab-target': [],
  'mod-lab-keys': [],
  'scratch-mod': [],
  'gallery-mod': [],
}

const folders = process.argv.slice(2).map(folder => resolve(folder))

const { path: types, looked } = findTypes({
  explicit: process.env.MOD_LAB_TYPES,
  roots: [...folders, ...Object.keys(MODS).map(mod => join(REPO, 'mods', mod))],
})
if (types === null) {
  console.error(`No claude-code.d.ts found. Looked at: ${looked.join(', ')}. Set MOD_LAB_TYPES to its path.`)
  process.exit(1)
}
console.log(`declarations: ${types}`)

const given = folders.map(dir => ({ name: relative(REPO, dir), include: ['hooks', 'types', 'tests'].map(part => join(dir, part)), files: dependencyContracts(dir) }))

const everything = () => [
  ...Object.entries(MODS).map(([mod, dependencies]) => ({
    name: mod,
    include: ['hooks', 'types', 'tests'].map(part => join(REPO, 'mods', mod, part)),
    files: dependencies.map(dependency => join(REPO, 'mods', dependency, 'types', 'index.d.ts')),
  })),
  ...readdirSync(join(REPO, 'templates'))
    .filter(name => existsSync(join(REPO, 'templates', name, '.claude-plugin', 'plugin.json')))
    .map(name => ({ name: `templates/${name}`, include: ['hooks', 'types', 'tests'].map(part => join(REPO, 'templates', name, part)), files: [] })),
  ...loadLessons(join(REPO, 'learn')).flatMap(lesson =>
    // A starter elsewhere (another lesson's solution) is checked there.
    ['solution', 'starter']
      .filter(part => existsSync(join(lesson.dir, part)))
      .map(part => ({
        name: `${lesson.path}/${part}`,
        include: [join(lesson.dir, part, 'hooks'), join(lesson.dir, part, 'types'), ...(part === 'solution' ? [join(lesson.dir, 'checks')] : [])],
        files: dependencyContracts(join(lesson.dir, part)),
      })),
  ),
]

let failed = false
for (const target of given.length > 0 ? given : everything()) {
  const result = typecheck({ include: target.include, files: [...declarationFiles(types), ...target.files] })
  if (result.output !== '') console.log(result.output)
  console.log(`${result.status === 0 ? 'ok  ' : 'FAIL'} ${target.name}`)
  failed ||= result.status !== 0
}
process.exit(failed ? 1 : 0)
