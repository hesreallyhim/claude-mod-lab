// A lesson's folder in the workshop, made where there is none: a copy of the
// lesson's starter where it has one, else the folder with the manifest alone,
// which the lesson's first step goes on from. The manifest is written last: a
// session loads a new folder in its workshop/ once the folder has one.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const MANIFEST = join('.claude-plugin', 'plugin.json')

/** The files the engine writes into a mod it loads, which a starter copied from a loaded folder may hold. */
const isLaid = path => path === 'tsconfig.json' || path.startsWith(join('.claude-plugin', 'types'))

/**
 * Copies a complete source reference without the manifest that makes it loadable.
 * An existing reference is left untouched, including any notes or edits made to it.
 *
 * @param {{ dir: string }} lesson as loadLessons answers it
 * @param {string} destination a folder outside workshop/, normally solutions/<lesson id>
 * @returns {boolean} whether a new reference was copied
 */
export function copyLessonSolution(lesson, destination) {
  if (existsSync(destination)) return false
  const source = join(lesson.dir, 'solution')
  cpSync(source, destination, {
    recursive: true,
    force: false,
    filter: file => {
      const path = relative(source, file)
      return path !== '.claude-plugin' && path !== 'tsconfig.json'
    },
  })
  return true
}

/**
 * Makes the lesson's folder at `modDir` unless something is there already.
 * Answers how it was made, or null when it was not.
 *
 * @param {{ mod: string, starter: string | null }} lesson as loadLessons answers it
 * @param {string} modDir
 * @returns {'starter' | 'manifest' | null}
 */
export function startLesson(lesson, modDir) {
  if (existsSync(modDir)) return null
  const manifest = join(modDir, MANIFEST)
  if (lesson.starter !== null) {
    cpSync(lesson.starter, modDir, {
      recursive: true,
      filter: source => {
        const path = relative(lesson.starter, source)
        return path !== MANIFEST && !isLaid(path)
      },
    })
    mkdirSync(dirname(manifest), { recursive: true })
    cpSync(join(lesson.starter, MANIFEST), manifest)
    return 'starter'
  }
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, `${JSON.stringify({ name: lesson.mod, version: '0.1.0' }, null, 2)}\n`)
  return 'manifest'
}
