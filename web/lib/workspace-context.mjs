// File destinations are chosen independently of the explorer process's cwd.
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { isWorkspace } from './roots.mjs'

export const LESSON_SETUP =
  'Run /init-lessons in a session started by npx claude-mod-lab run, or create a dedicated workspace with npx claude-mod-lab init-lessons <directory>.'

function directory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : null
  } catch {
    return null
  }
}

function lessons(path) {
  const root = directory(path)
  return root !== null && root !== directory(homedir()) && isWorkspace(root) ? root : null
}

/**
 * Explicit options support a session-owned server; a standalone server starts without either root.
 * @param {{ hub: ReturnType<typeof import('./hub.mjs').createHub>, workspace?: string, lessonWorkspace?: string | null }} options
 */
export function createWorkspaceContext({ hub, workspace, lessonWorkspace = null }) {
  const fallback = directory(workspace)
  const configuredLessons = lessons(lessonWorkspace)
  if (lessonWorkspace !== null && configuredLessons === null) throw new Error(LESSON_SETUP)

  function snapshot() {
    const session = hub.snapshot().session
    if (session === null) return { project: fallback, lessonWorkspace: configuredLessons }
    if (!session.isConnected) return { project: null, lessonWorkspace: null }
    const project = directory(session.facts.cwd)
    const selected = Object.hasOwn(session.lab ?? {}, 'lessons') ? lessons(session.lab.lessons) : configuredLessons
    return { project, lessonWorkspace: selected !== null && selected === project ? selected : null }
  }

  function requireProject(expected) {
    const current = snapshot().project
    if (current === null)
      throw new Error('Connect a session with npx claude-mod-lab run <project> before adding a component.')
    if (current === directory(homedir()))
      throw new Error(
        'Choose a project folder before adding components; the home folder contains globally loaded skills.',
      )
    if (expected !== current)
      throw new Error('The connected project changed. Refresh this page before changing its files.')
    return current
  }

  function requireLessons(expected) {
    const current = snapshot().lessonWorkspace
    if (current === null) throw new Error(LESSON_SETUP)
    if (expected !== current)
      throw new Error('The lesson workspace changed. Refresh this page before changing its files.')
    return current
  }

  return { snapshot, requireProject, requireLessons }
}
