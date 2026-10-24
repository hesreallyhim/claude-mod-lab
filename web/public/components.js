// Add to project: a mod from templates/ copied into the project's
// component collection, which the session picks up when the lab runs
// /reload-plugins for it. The copy is the person's to edit; Remove deletes
// it, asking first when it holds changes. Used by the Prompt box and Gallery pages.

import { api } from './api.js'
import { needsNewer } from './versions.js'
import { el } from './view.js'

// The server's list, asked for once per page drawn.
let listed = null
// A live registry event must win over an older HTTP response that arrives later.
let latestCommands

export function resetComponentCommands() {
  latestCommands = undefined
}

function commandAvailable(commands, name, plugin) {
  return Array.isArray(commands) ? commands.some(one => one?.name === name && one?.plugin === plugin) : null
}

function list() {
  listed ??= api('/api/components').catch(error => ({ error: error.message, dir: '.claude/skills', components: [] }))
  return listed
}

/** Forgets the list, so the next page drawn asks again. */
export function forgetComponents() {
  listed = null
}

function addedLine(component, directory) {
  const where = el('code', {}, `${directory}/${component.name}`)
  const edited = component.isEdited ? ', edited' : ''
  return el(
    'p',
    {
      class: 'component-state',
      title: 'Files are present in this project. Check the reload result and try the mod below.',
    },
    '✓ Added to project: ',
    where,
    edited,
  )
}

function commandText(command, available) {
  if (available === true) return `Available in session: /${command}`
  if (available === false) return `Not listed in this session: /${command}`
  return `Session command not checked yet: /${command}`
}

function commandStatus(component) {
  if (!component.command) return null
  return el(
    'p',
    {
      class: 'component-command muted',
      'data-component-command': component.command,
      'data-command-plugin': component.name,
      role: 'status',
    },
    commandText(
      component.command,
      latestCommands === undefined
        ? component.commandAvailable
        : commandAvailable(latestCommands, component.command, component.name),
    ),
  )
}

/** Refresh only command feedback, keeping in-progress Add/Remove controls intact. */
export function refreshComponentCommands(commands) {
  latestCommands = commands
  for (const node of document.querySelectorAll('[data-component-command]')) {
    const command = node.getAttribute('data-component-command')
    const plugin = node.getAttribute('data-command-plugin')
    const available = commandAvailable(commands, command, plugin)
    node.textContent = commandText(command, available)
  }
}

function addedParts(component, directory, busy, remove) {
  return [
    addedLine(component, directory),
    commandStatus(component),
    component.howToTry === null ? null : el('p', { class: 'component-try' }, component.howToTry),
    el(
      'div',
      { class: 'component-actions' },
      el(
        'button',
        { type: 'button', class: 'quiet', disabled: busy !== null, onclick: () => remove(false) },
        busy ?? 'Remove',
      ),
    ),
  ].filter(part => part !== null)
}

function componentNotes(component, reload, problem) {
  const notes = []
  if (component.loadProblem) notes.push(el('p', { class: 'error', role: 'status' }, component.loadProblem))
  if (reload?.note && reload.note !== component.loadProblem) notes.push(el('p', { class: 'muted' }, reload.note))
  if (problem !== null) notes.push(el('p', { class: 'error' }, problem))
  return notes
}

const componentDirectory = (component, fallback) => component.directory ?? fallback

/** The control for one component, drawn from the server's last answer. */
function draw(box, component, dir, project, { reload = null, busy = null, isConfirming = false, problem = null } = {}) {
  const directory = componentDirectory(component, dir)
  const redraw = (shown, options) => draw(box, shown, dir, project, options)
  const act = async (path, body, label) => {
    redraw(component, { busy: label })
    try {
      const answer = await api(path, {
        method: 'POST',
        body: JSON.stringify({ name: component.name, project, directory, ...body }),
      })
      forgetComponents()
      // Only the list carries the minimum, so it is kept from the component as listed.
      const shown = { ...answer.component, since: component.since }
      redraw(shown, answer.component.isRefused ? { isConfirming: true } : { reload: answer.reload })
    } catch (error) {
      redraw(component, { problem: error.message })
    }
  }
  const add = () => act('/api/components/add', {}, 'Adding…')
  const remove = force => act('/api/components/remove', { force }, 'Removing…')

  const parts = []
  if (component.isForeign) {
    parts.push(
      el(
        'p',
        { class: 'muted' },
        el('code', {}, `${directory}/${component.name}`),
        ' is a folder of another plugin or skill, so this one is not added there.',
      ),
    )
  } else if (!component.isAdded) {
    parts.push(
      el(
        'div',
        { class: 'component-actions' },
        el('button', { type: 'button', disabled: busy !== null, onclick: add }, busy ?? 'Add to project'),
      ),
      el(
        'p',
        { class: 'muted' },
        'A copy of ',
        el('code', {}, `templates/${component.name}`),
        ' in ',
        el('code', {}, directory),
        ', yours to edit.',
      ),
    )
  } else if (isConfirming) {
    parts.push(
      el('p', {}, el('code', {}, `${directory}/${component.name}`), ' has changes of yours. Remove it and them?'),
      el(
        'div',
        { class: 'component-actions' },
        el('button', { type: 'button', onclick: () => remove(true) }, 'Remove with changes'),
        el('button', { type: 'button', class: 'quiet', onclick: () => redraw(component) }, 'Keep it'),
      ),
    )
  } else {
    parts.push(...addedParts(component, directory, busy, remove))
  }
  box.replaceChildren(...parts, ...componentNotes(component, reload, problem))
}

/**
 * Add to project for the component of this name; it draws nothing where the
 * server has none, or the template needs a newer Claude Code than the
 * session's `version` (null when no session is connected).
 */
export function componentControl(name, version = null) {
  const box = el('div', { class: 'component', 'data-component': name })
  void list().then(({ dir, components, project, error }) => {
    if (error || !project) {
      box.replaceChildren(el('p', { class: 'muted' }, error || 'Connect a session to add this mod to its project.'))
      return
    }
    const component = components.find(one => one.name === name)
    // A template that needs a newer Claude Code than the session runs is not offered.
    if (component === undefined || (!component.isForeign && needsNewer(component.since, version))) box.remove()
    else draw(box, component, dir, project)
  })
  return box
}
