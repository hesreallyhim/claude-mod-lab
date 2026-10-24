// The lab's lesson state for a workspace, in .claude-mod-lab/progress.json:
// the current lesson, which is the one last opened or checked, and each
// lesson's last check: how many of its checked steps passed, when, and the
// checker's report as text. The checker writes it after each check, the
// explorer when a lesson's page opens, and mod-lab's lesson tool reads it.
// It is written whole as it changes, through a file renamed into place, so a
// reader never sees half of it.

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { STATE_DIR } from './roots.mjs'

/**
 * @typedef {{ passed: number, total: number, at: number, report: string }} LessonCheck
 * @typedef {{ current: string | null, lessons: Record<string, LessonCheck> }} Progress
 */

/** The state file of the workspace `workspace`. */
export const progressFile = workspace => join(workspace, STATE_DIR, 'progress.json')

/**
 * The workspace's lesson state; no current lesson and no checks where the
 * file is missing or unreadable.
 *
 * @param {string} workspace
 * @returns {Progress}
 */
export function readProgress(workspace) {
  let read
  try {
    read = JSON.parse(readFileSync(progressFile(workspace), 'utf8'))
  } catch {
    read = null
  }
  return {
    current: typeof read?.current === 'string' ? read.current : null,
    lessons: read?.lessons !== null && typeof read?.lessons === 'object' ? read.lessons : {},
  }
}

/** @param {string} workspace @param {Progress} progress */
function writeProgress(workspace, progress) {
  const file = progressFile(workspace)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomBytes(4).toString('hex')}`
  writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`)
  renameSync(temporary, file)
}

/** Makes the lesson `id` the current one. */
export function openLesson(workspace, id) {
  const progress = readProgress(workspace)
  if (progress.current !== id) writeProgress(workspace, { ...progress, current: id })
}

/**
 * Records a check of the lesson `id`, which becomes the current lesson.
 *
 * @param {string} workspace
 * @param {string} id
 * @param {{ passed: number, total: number, report: string }} check
 */
export function recordCheck(workspace, id, { passed, total, report }, at = Date.now()) {
  const { lessons } = readProgress(workspace)
  writeProgress(workspace, { current: id, lessons: { ...lessons, [id]: { passed, total, at, report } } })
}
