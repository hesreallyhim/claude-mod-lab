// The templates, and the gallery mod, as components the explorer adds to a session: each copied
// whole into the project's collection passed with --plugin-dir, or its
// .claude/skills/ for sessions started without the lab launcher.
// The copy is the person's to edit; a watched session reloads it on save.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { templateNames } from './sandbox.mjs'

/** What to do once a component is in the session, by its name. web/test/components.test.mjs fails on a template without one. */
export const HOW_TO_TRY = {
  'brackets-mod': 'Type ( in the prompt box: its partner goes in after the cursor.',
  'draft-keeper-mod': 'Type a prompt, clear it with Ctrl+C, then press Tab in the empty box to bring it back.',
  'keycast-mod': 'Type in the prompt box: each key shows above it as you press it. /keycast-mod off hides them.',
  'paint-mod':
    'Type /con in the prompt box: the rest of a command follows as ghost text, and a word no command starts with is underlined.',
  'paste-guard-mod':
    'Paste a key-shaped string, such as ghp_ and 36 letters: it is painted red, and Enter holds the prompt back once.',
  'shortcodes-mod':
    'Type :te in the prompt box: the rest shows as ghost text, and the closing colon writes the prompt :tests: stands for.',
  'band-mod': 'A line above the prompt counts tool calls; /band-mod off hides it.',
  'hover-mod':
    '/hover-mod opens a pane of three words. Point at one with the mouse: a card explaining that part of the technique appears above it.',
  'image-mod': '/image-mod opens a picture in a pane, on a terminal that shows images; /image-mod stop ends it.',
  'links-mod': '/links-mod opens a pane; click a link to turn its page.',
  'raster-mod': '/raster-mod opens a wave in a pane; /raster-mod stop ends it.',
  'sites-mod': 'After a tool call, ctrl+o shows a line under its row saying how long it ran.',
  'svg-mod': '/svg-mod opens a bar chart of tool calls, drawn as an Svg on desktop, VS Code and mobile.',
  'gallery-mod': '/mod-gallery opens every technique in one pane, a tab each; /mod-gallery raster opens one tab.',
}

// Commands these mods register; prompt-only mods have no command to verify.
const COMMANDS = {
  'gallery-mod': 'mod-gallery',
  'band-mod': 'band-mod',
  'keycast-mod': 'keycast-mod',
  'hover-mod': 'hover-mod',
  'image-mod': 'image-mod',
  'links-mod': 'links-mod',
  'raster-mod': 'raster-mod',
  'svg-mod': 'svg-mod',
}

// Files the engine writes beside a mod it loads; never the template's, so never compared or copied.
export const isEngineFile = path =>
  path === 'tsconfig.json' || path.startsWith(`.claude-plugin${sep}types`) || path.endsWith('.DS_Store')

/** Every file under `dir` but the engine's, as paths relative to it. */
export function filesOf(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)))
    .filter(path => !isEngineFile(path))
    .sort()
}

/** Copies a mod's folder to `to`, without the files the engine laid in it. `claude-mod-lab add` copies with this too. */
export function copyMod(from, to) {
  const manifest = join('.claude-plugin', 'plugin.json')
  // A watched collection discovers a plugin once its manifest exists. Publish it last.
  cpSync(from, to, {
    recursive: true,
    filter: source => relative(from, source) !== manifest && !isEngineFile(relative(from, source)),
  })
  if (existsSync(join(from, manifest))) {
    mkdirSync(join(to, '.claude-plugin'), { recursive: true })
    copyFileSync(join(from, manifest), join(to, manifest))
  }
}

function manifestOf(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * The components: every template in `templatesDir`, and each mod in `others`, by its name, a folder
 * outside the templates (the gallery mod, from mods/).
 */
export function createComponents({ templatesDir, skillsDir, legacyDir = null, others = {} }) {
  const templateDir = name => (Object.hasOwn(others, name) ? others[name] : join(templatesDir, name))
  const copyDir = name => {
    const target = join(skillsDir, name)
    if (existsSync(target) || legacyDir === null) return target
    const legacy = join(legacyDir, name)
    return manifestOf(legacy)?.name === name ? legacy : target
  }
  const names = () => [...templateNames(templatesDir), ...Object.keys(others)]

  function known(name) {
    if (!names().includes(name)) throw new Error(`no component is named ${name}`)
  }

  /** Whether the copy differs from the template: a file changed, added or removed. */
  function isEdited(name) {
    const theirs = filesOf(templateDir(name))
    const ours = filesOf(copyDir(name))
    if (theirs.join('\n') !== ours.join('\n')) return true
    return theirs.some(
      path => readFileSync(join(templateDir(name), path), 'utf8') !== readFileSync(join(copyDir(name), path), 'utf8'),
    )
  }

  /** A component as the page shows it. `isForeign` is a folder of that name that is not the component's. */
  function view(name) {
    const at = copyDir(name)
    const isThere = existsSync(at)
    const isForeign = isThere && manifestOf(at)?.name !== name
    const isAdded = isThere && !isForeign
    return {
      name,
      directory: dirname(at),
      command: COMMANDS[name] ?? null,
      description: manifestOf(templateDir(name))?.description ?? '',
      howToTry: HOW_TO_TRY[name] ?? null,
      isAdded,
      isEdited: isAdded && isEdited(name),
      isForeign,
    }
  }

  return {
    dir: skillsDir,
    list: () => names().map(view),
    view(name) {
      known(name)
      return view(name)
    },

    /** Copies the template into the skills folder; refused where a folder of that name is already there. */
    add(name) {
      known(name)
      if (existsSync(copyDir(name))) throw new Error(`${copyDir(name)} is already there`)
      copyMod(templateDir(name), copyDir(name))
      return view(name)
    },

    /** Deletes the copy. One with changes of the person's goes only with `force`, and is answered `isRefused` otherwise. */
    remove(name, { force = false } = {}) {
      known(name)
      const current = view(name)
      if (current.isForeign) throw new Error(`${copyDir(name)} is not the ${name} component, so it is left alone`)
      if (!current.isAdded) return current
      if (current.isEdited && !force) return { ...current, isRefused: true }
      rmSync(copyDir(name), { recursive: true, force: true })
      return view(name)
    },
  }
}
