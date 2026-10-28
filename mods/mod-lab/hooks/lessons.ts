import type { EngineInterface } from 'claude-code'

import { explorerCommand } from './explorer'
import { messageOf } from './runner'

const SERVER = 'plugin:mod-lab-bridge:explorer'
type LessonSession = { cwd: string; collection: string | null }

async function lessonSession($: EngineInterface): Promise<LessonSession> {
  const cwd = await $.session.cwd()
  const existing = (await $.env.get('MOD_LAB_LESSONS')) === cwd
  const advertised = await $.env.get('MOD_LAB_LESSON_COLLECTION')
  if (existing && !advertised) return { cwd, collection: null }
  const collection = advertised || `${cwd}/.claude/mod-lab`
  const directories: unknown = JSON.parse((await $.env.get('MOD_LAB_COMPONENT_DIRS')) || '[]')
  if (!Array.isArray(directories) || !directories.includes(collection)) {
    throw new Error('This session has no lab plugin folder to load lesson mods. Start it with npx claude-mod-lab run in this project, then use /init-lessons.')
  }
  return { cwd, collection }
}

async function initializeWorkspace($: EngineInterface, session: LessonSession): Promise<string> {
  const args = session.collection === null ? { cwd: session.cwd } : { cwd: session.cwd, collection: session.collection }
  const result = await $.mcp.call(SERVER, 'init-lessons', args)
  const text = result.content.map(block => block.text ?? '').join('\n').trim()
  if (result.isError) throw new Error(`Lessons were not enabled: ${text}`)
  const setup = JSON.parse(text) as { workspace?: unknown }
  if (typeof setup.workspace !== 'string' || setup.workspace === '') throw new Error('The bridge returned no lesson workspace.')
  return setup.workspace
}

async function activateLessons($: EngineInterface, workspace: string, collection: string | null): Promise<void> {
  if (collection !== null) {
    const loading = await $.env.set('MOD_LAB_LESSON_COLLECTION', collection)
    if (loading.deny) throw new Error(loading.deny)
  }
  const enabled = await $.env.set('MOD_LAB_LESSONS', workspace)
  if (enabled.deny) throw new Error(enabled.deny)
}

export async function initLessonsCommand($: EngineInterface, args: string): Promise<string> {
  if (args.trim() !== '') return 'Use /init-lessons without arguments to enable lessons in this project.'
  try {
    const session = await lessonSession($)
    const workspace = await initializeWorkspace($, session)
    await activateLessons($, workspace, session.collection)
    const explorer = await explorerCommand($, '', 'command')
    const address = explorer.match(/https?:\/\/localhost:\d+/)?.[0]
    const next = address === undefined ? explorer : `Open Lessons: ${address}/#learn`
    return `Lessons enabled in ${workspace}. Your existing files are unchanged.\nChoose a lesson and use Start; edit its files in workshop/. Reference solutions go in solutions/.\n${next}`
  } catch (error) {
    return `/init-lessons could not finish: ${messageOf(error)}`
  }
}
