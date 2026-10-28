// The Agents page: agent types registered and agents spawned through the lab,
// every agent the session started with its answer, a switch that hides a type
// from the model, and a route that sends every new spawn to one model.

import { pageHead } from './areas.js'
import { agentTranscriptView } from './agent-transcript.js'
import { lede, modelSelect, MODELS, notes } from './page.js'
import { el, fill, openReaderDialog, openTextDialog, textPreview } from './view.js'

const BUILT_IN = ['general-purpose', 'Explore', 'Plan']

function agentPanel(title, open, ...children) {
  return el(
    'details',
    { class: 'agent-panel', open },
    el('summary', {}, el('h2', {}, title)),
    el('div', { class: 'agent-panel-body controls' }, children),
  )
}

function runRow(run, sendCommand) {
  const took = run.durationMs === null ? '' : ` in ${(run.durationMs / 1000).toFixed(1)} s`
  return el(
    'article',
    { class: `run agent ${run.status}` },
    el(
      'header',
      {},
      el('strong', {}, run.type),
      ` ${run.agentId} · by ${run.by} · on ${run.model ?? 'its own model'}${run.isRouted ? ' (routed)' : ''} · `,
      el('span', { class: run.status === 'done' ? 'ok' : 'muted' }, `${run.status}${took}`),
    ),
    el('div', { class: 'muted' }, textPreview(`${run.type} · Prompt`, run.prompt)),
    el(
      'div',
      { class: 'inline-form' },
      run.answer === null
        ? null
        : el(
            'button',
            {
              type: 'button',
              class: 'quiet',
              'aria-haspopup': 'dialog',
              onclick: () => openTextDialog(`${run.type} · ${run.agentId} answer`, run.answer, 'Close answer'),
            },
            'View answer',
          ),
      el(
        'button',
        {
          type: 'button',
          class: 'quiet',
          'aria-haspopup': 'dialog',
          onclick: () => {
            const transcript = el('div')
            openReaderDialog(`${run.type} · ${run.agentId} transcript`, transcript, 'Close transcript')
            void sendCommand(`agent transcript-json ${run.agentId}`, transcript, answer =>
              agentTranscriptView(answer, run.agentId),
            )
          },
        },
        'View transcript',
      ),
    ),
  )
}

function liveParts(agents, sendCommand) {
  const facts = [
    `Types the lab registered: ${agents.types.length === 0 ? 'none yet' : agents.types.map(type => type.agent).join(', ')}.`,
    `Hidden from the model: ${agents.hidden.length === 0 ? 'none' : agents.hidden.join(', ')}.`,
    agents.route === null ? 'Spawns run on the model they ask for.' : `Every new spawn is sent to ${agents.route}.`,
  ]
  const runs = [...agents.runs].reverse()
  return [
    el('p', { class: 'muted readings-summary' }, facts.join(' ')),
    runs.length === 0
      ? el('p', { class: 'muted' }, 'No agent has been spawned in this session yet: spawn one above.')
      : runs.map(run => runRow(run, sendCommand)),
  ]
}

/** Redraws the live parts in place, leaving the forms as typed. */
export function refreshAgents(state, sendCommand) {
  const live = document.querySelector('[data-live="agents"]')
  if (live === null) return
  fill(live, liveParts(state.mirror.agents, sendCommand))
  const types = document.getElementById('agent-types')
  if (types !== null)
    types.replaceChildren(
      ...[...state.mirror.agents.types.map(type => type.agent), ...BUILT_IN].map(name => el('option', { value: name })),
    )
}

/** `ctx`: the page's `state` and `sendCommand(text, target)`. */
export function agentsPage(ctx) {
  const { state, sendCommand } = ctx
  const registerStatus = el('div', { class: 'result' })
  const spawnStatus = el('div', { class: 'result' })
  const switchStatus = el('div', { class: 'result' })
  const form = (onsubmit, ...children) =>
    el(
      'form',
      {
        class: 'probe',
        onsubmit: event => {
          event.preventDefault()
          // The submitter carries which button was pressed: hide, show or route.
          onsubmit(Object.fromEntries(new FormData(event.currentTarget, event.submitter).entries()))
        },
      },
      ...children,
    )
  const field = (label, name, attrs = {}) => el('label', {}, el('span', {}, label), el('input', { name, ...attrs }))
  const register = form(
    data => {
      const spec = {
        name: data.name,
        description: data.description,
        prompt: data.prompt,
        model: data.model,
        tools: String(data.tools)
          .split(',')
          .map(tool => tool.trim())
          .filter(Boolean),
        maxTurns: Number(data.maxTurns),
      }
      void sendCommand(`agent register ${JSON.stringify(spec)}`, registerStatus)
    },
    field('name', 'name', { value: 'counter' }),
    field('description', 'description', { value: 'Counts the files that match a pattern' }),
    el(
      'label',
      {},
      el('span', {}, 'prompt'),
      el('textarea', { name: 'prompt', rows: 3 }, 'You count files. Use Glob, then answer with the count alone.'),
    ),
    el('label', {}, el('span', {}, 'model'), modelSelect('model')),
    field('tools', 'tools', { value: 'Glob' }),
    field('max turns', 'maxTurns', { value: '3', type: 'number' }),
    el('button', { type: 'submit' }, 'Register'),
    registerStatus,
  )
  const spawn = form(
    data => void sendCommand(`agent spawn ${data.type} ${data.prompt}`, spawnStatus),
    field('type', 'type', { value: 'general-purpose', list: 'agent-types' }),
    el('datalist', { id: 'agent-types' }),
    field('prompt', 'prompt', { value: 'How many .md files are in the docs folder? Answer with the number.' }),
    el('button', { type: 'submit' }, 'Spawn'),
    spawnStatus,
  )
  const switches = form(
    data =>
      void sendCommand(
        `agent ${data.action === 'route' ? `route ${data.route}` : `${data.action} ${data.type}`}`,
        switchStatus,
      ),
    field('type', 'type', { value: 'Plan', list: 'agent-types' }),
    el(
      'div',
      { class: 'buttons' },
      el('button', { type: 'submit', name: 'action', value: 'hide' }, 'Hide from the model'),
      el('button', { type: 'submit', name: 'action', value: 'show', class: 'quiet' }, 'Offer again'),
    ),
    el(
      'label',
      {},
      el('span', {}, 'route spawns to'),
      el('select', { name: 'route' }, ...['off', ...MODELS].map(model => el('option', { value: model }, model))),
    ),
    el('button', { type: 'submit', name: 'action', value: 'route' }, 'Set the route'),
    switchStatus,
  )
  const page = el(
    'div',
    { class: 'page' },
    pageHead(
      'Agents',
      notes(
        "A spawn's answer arrives with its turn.complete, and the main model also reads it, as a message from the agent. The lab's hook on agent.spawn sees every spawn, the model's own included, and its hook on agent.offer can hide a type from the model while plugins still spawn it.",
        "The route rewrites each new spawn's model on its way down, a budget a mod can enforce; resumes and forks keep theirs.",
      ),
    ),
    lede(
      'Agent types a mod registers, agents spawned through the lab, and every agent the session started, with its answer.',
    ),
    el(
      'div',
      { class: 'agent-panels' },
      agentPanel(
        'Spawn an agent',
        true,
        el('p', {}, 'A spawn runs in the background and spends tokens; its answer arrives with its turn.'),
        spawn,
      ),
      agentPanel('Agents this session', false, el('div', { 'data-live': 'agents' })),
      agentPanel(
        'Register an agent type',
        false,
        el('p', {}, "A type joins the model's Agent tool from its next turn, and a mod can spawn it itself."),
        register,
      ),
      agentPanel(
        'Hide types and route spawns',
        false,
        el(
          'p',
          {},
          'Hiding takes a type from the model while a mod can still start it, built-in types included. The route sends each new spawn to one model.',
        ),
        switches,
      ),
    ),
  )
  queueMicrotask(() => refreshAgents(state, sendCommand))
  return page
}
