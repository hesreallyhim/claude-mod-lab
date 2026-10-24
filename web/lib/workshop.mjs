// The person's mods in the workspace's workshop/, a folder of plugins the
// session the lab started loads, every mod in it. Each can be turned
// off for the workspace with "<name>@inline": false in enabledPlugins in its
// .claude/settings.local.json, which a session reads when it reloads its
// plugins; turned on again, the entry goes. A lesson's mod is listed with its
// lessons, and with what it does beyond the session's own work as the
// lesson's steps name it: the calls on $ that spend model tokens or make sound.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The settings file the switches write, from the workspace. */
export const SETTINGS = join('.claude', 'settings.local.json')

/** What a lesson's mod does that the person should know before leaving it on, by the calls on $ its steps name. */
const EFFECTS = [
  { prefix: '$.model.', says: 'makes model calls' },
  { prefix: '$.audio.', says: 'plays sound' },
]

const settingKey = name => `${name}@inline`

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The workspace's local settings; an empty object where there are none, and an error where the file is not JSON. */
function readSettings(workspace) {
  const path = join(workspace, SETTINGS)
  if (!existsSync(path)) return {}
  const settings = readJson(path)
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${SETTINGS} is not a JSON object, so it was left as it is: mend it, then try again`)
  }
  return settings
}

/**
 * What the lessons say of a mod's effects, from the calls their steps name: each of EFFECTS's words once.
 *
 * @param {{ steps: { calls?: string[] }[] }[]} lessons
 * @returns {string[]}
 */
export function effectsOf(lessons) {
  const calls = lessons.flatMap(lesson => lesson.steps.flatMap(step => step.calls ?? []))
  return EFFECTS.filter(effect => calls.some(call => call.startsWith(effect.prefix))).map(effect => effect.says)
}

/**
 * Each mod in the workspace's workshop/: a folder with a plugin manifest,
 * named as its manifest names it, whether it is on, and the lessons that
 * build it with their effects.
 *
 * @param {string} workspace
 * @param {{ id: string, mod: string, title: string, steps: { calls?: string[] }[] }[]} lessons
 */
export function listWorkshop(workspace, lessons) {
  const workshop = join(workspace, 'workshop')
  if (!existsSync(workshop)) return []
  let enabled = {}
  try {
    enabled = readSettings(workspace).enabledPlugins ?? {}
  } catch {
    // Unreadable settings turn nothing off here; the switch says why it cannot write them.
  }
  return readdirSync(workshop, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      folder: entry.name,
      manifest: readJson(join(workshop, entry.name, '.claude-plugin', 'plugin.json')),
    }))
    .filter(({ manifest }) => typeof manifest?.name === 'string')
    .map(({ folder, manifest }) => {
      const built = lessons.filter(lesson => lesson.mod === folder)
      return {
        folder,
        name: manifest.name,
        description: typeof manifest.description === 'string' ? manifest.description : '',
        isOn: enabled[settingKey(manifest.name)] !== false,
        lessons: built.map(({ id, title }) => ({ id, title })),
        effects: effectsOf(built),
      }
    })
    .sort((a, b) => a.folder.localeCompare(b.folder))
}

/**
 * Turns the workshop's mod `name` on or off for the workspace, in its local
 * settings, and answers the mod as listWorkshop does. Refuses a name that is
 * not a workshop mod's, and settings it cannot read.
 *
 * @param {string} workspace
 * @param {Parameters<typeof listWorkshop>[1]} lessons
 * @param {string} name
 * @param {boolean} isOn
 */
export function switchMod(workspace, lessons, name, isOn) {
  if (!listWorkshop(workspace, lessons).some(mod => mod.name === name)) {
    throw new Error(`no mod in workshop/ is named ${name}`)
  }
  const settings = readSettings(workspace)
  const enabledPlugins = { ...settings.enabledPlugins }
  if (isOn) delete enabledPlugins[settingKey(name)]
  else enabledPlugins[settingKey(name)] = false
  const next = { ...settings, enabledPlugins }
  if (Object.keys(enabledPlugins).length === 0) delete next.enabledPlugins
  const path = join(workspace, SETTINGS)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return listWorkshop(workspace, lessons).find(mod => mod.name === name)
}
