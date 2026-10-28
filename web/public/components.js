// Add to lab or project: a mod from examples/ copied into the selected
// component collection. Watched collections can reload in this session; other
// copies need a session started with the matching launcher scope. The copy is
// the person's to edit; Remove asks first when it holds changes. Used by the
// Prompt box and Gallery pages.

import { api } from './api.js'
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
      title: 'Files are present in the selected collection. Check the reload result and activate the mod below.',
    },
    component.scope === 'shared' ? '✓ Added to your lab: ' : '✓ Added to project: ',
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
      'data-command-supplied': String(component.commandEligible ?? true),
      role: 'status',
    },
    commandText(
      component.command,
      component.commandEligible === false
        ? false
        : latestCommands === undefined
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
    const available =
      node.getAttribute('data-command-supplied') === 'false' ? false : commandAvailable(commands, command, plugin)
    node.textContent = commandText(command, available)
  }
}

function componentNotes(component, reload, problem) {
  const notes = []
  if (component.scope === 'shared') {
    notes.push(
      el(
        'p',
        { class: 'muted' },
        'Shared across lab sessions. Activate it separately in each session; editing or removing the files affects every session using this copy.',
      ),
    )
  }
  if (!component.isAdded && component.isSupplied === false) {
    notes.push(
      el(
        'p',
        { class: 'muted' },
        `This session does not load this folder. After adding, start a session with npx claude-mod-lab run${component.scope === 'local' ? ' --local' : ''} to use this copy.`,
      ),
    )
  }
  if (component.loadProblem) notes.push(el('p', { class: 'error', role: 'status' }, component.loadProblem))
  if (reload?.note && reload.note !== component.loadProblem) notes.push(el('p', { class: 'muted' }, reload.note))
  if (problem !== null) notes.push(el('p', { class: 'error' }, problem))
  return notes
}

const componentDirectory = (component, fallback) => component.directory ?? fallback

/** Mutations update only this destination, retaining the other copy's status. */
function destinationActions(copy, directory, { component, destinations, states, project, redraw }) {
  const key = copy.scope ?? 'local'
  const act = async (path, body, label) => {
    redraw(component, { ...states, [key]: { busy: label } })
    try {
      const answer = await api(path, {
        method: 'POST',
        body: JSON.stringify({ name: copy.name, project, directory, scope: copy.scope, ...body }),
      })
      forgetComponents()
      const shown =
        destinations.length > 1
          ? { ...component, destinations: destinations.map(one => (one.scope === key ? answer.component : one)) }
          : answer.component
      redraw(shown, {
        ...states,
        [key]: answer.component.isRefused ? { isConfirming: true } : { reload: answer.reload },
      })
    } catch (error) {
      redraw(component, { ...states, [key]: { problem: error.message } })
    }
  }
  return {
    add: () => act('/api/components/add', {}, 'Adding…'),
    remove: force => act('/api/components/remove', { force }, 'Removing…'),
    keep: () => redraw(component, { ...states, [key]: {} }),
  }
}

function destinationButton(copy, state, busy, dual, { add, remove }) {
  if (copy.isForeign) return null
  const destination = copy.scope === 'shared' ? 'lab' : 'project'
  const label = copy.isAdded ? (dual ? `Remove from ${destination}` : 'Remove') : `Add to ${destination}`
  return el(
    'button',
    {
      type: 'button',
      class: copy.isAdded ? 'quiet' : '',
      disabled: busy || state.isConfirming === true || Boolean(copy.unavailable),
      onclick: () => (copy.isAdded ? remove(false) : add()),
    },
    state.busy ?? label,
  )
}

function removalConfirmation(copy, directory, busy, { remove, keep }) {
  return [
    el('p', {}, el('code', {}, `${directory}/${copy.name}`), ' has changes of yours. Remove it and them?'),
    el(
      'div',
      { class: 'component-actions' },
      el('button', { type: 'button', disabled: busy, onclick: () => remove(true) }, 'Remove with changes'),
      el('button', { type: 'button', class: 'quiet', disabled: busy, onclick: keep }, 'Keep it'),
    ),
  ]
}

function destinationContent(copy, state, directory, busy, actions) {
  if (copy.unavailable) return el('p', { class: 'muted' }, copy.unavailable)
  if (copy.isForeign) {
    return el(
      'p',
      { class: 'muted' },
      el('code', {}, `${directory}/${copy.name}`),
      ' belongs to another plugin or skill and will be left alone.',
    )
  }
  if (state.isConfirming) return removalConfirmation(copy, directory, busy, actions)
  if (copy.isAdded) {
    return [
      addedLine(copy, directory),
      commandStatus(copy),
      copy.howToTry ? el('p', { class: 'component-try' }, copy.howToTry) : null,
    ]
  }
  return el(
    'p',
    { class: 'muted' },
    `${copy.scope === 'shared' ? 'Lab' : 'Project'} copy: `,
    el('code', {}, directory),
    ', yours to edit.',
  )
}

/** Keep a destination's action and details together while rendering them in separate rows. */
function destinationControl(copy, context) {
  const key = copy.scope ?? 'local'
  const state = context.states[key] ?? {}
  const directory = componentDirectory(copy, context.dir)
  const actions = destinationActions(copy, directory, context)
  return {
    button: destinationButton(copy, state, context.busy, context.destinations.length > 1, actions),
    panel: el(
      'div',
      { 'data-component-scope': key },
      destinationContent(copy, state, directory, context.busy, actions),
      copy.unavailable ? null : componentNotes(copy, state.reload ?? null, state.problem ?? null),
    ),
  }
}

/** One row of destination actions, followed by independent copy status and safeguards. */
function draw(box, component, dir, project, states = {}) {
  const destinations = component.destinations ?? [component]
  const busy = Object.values(states).some(state => state.busy)
  const redraw = (shown = component, next = states) => draw(box, shown, dir, project, next)
  const context = { component, dir, project, states, destinations, busy, redraw }
  const controls = destinations.map(copy => destinationControl(copy, context))
  box.replaceChildren(
    el(
      'div',
      { class: 'component-actions' },
      controls.map(control => control.button),
    ),
    ...controls.map(control => control.panel),
  )
}

/** Shared and local controls for this component; draws nothing when the server has none. */
export function componentControl(name) {
  const box = el('div', { class: 'component', 'data-component': name })
  void list().then(({ dir, components, project, error }) => {
    if (error || !project) {
      box.replaceChildren(el('p', { class: 'muted' }, error || 'Connect a session to add this mod to its project.'))
      return
    }
    const component = components.find(one => one.name === name)
    if (component === undefined) box.remove()
    else draw(box, component, dir, project)
  })
  return box
}
