// Installed mods: what the validator reads in each hooks module on this
// machine, beside what the session's trace and taps show it doing.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { lede, notes, readings } from './page.js'
import { clockTime, el } from './view.js'

/** What the session showed a plugin doing: the events it answered in chains, and the calls it made. */
function observedOf(state, name) {
  const plain = plugin => String(plugin).split('@')[0]
  const inChains = new Set(
    state.traces.filter(row => row.chain.some(link => plain(link.plugin) === name)).map(row => row.event),
  )
  const called = new Set(state.taps.filter(tap => plain(tap.origin) === name).map(tap => tap.event))
  return { inChains: [...inChains], called: [...called] }
}

/** Split a validator list, preserving commas in qualifiers and quoted values. */
function splitCapabilities(value) {
  const pieces = ['']
  let depth = 0
  // Quoted strings are single tokens, so their commas and brackets cannot split a capability.
  const tokens = value.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[()[\]{},]|[^()[\]{},"'`]+/g) ?? []
  for (const token of tokens) {
    if ('([{'.includes(token)) depth += 1
    else if (')]}'.includes(token)) depth = Math.max(0, depth - 1)
    if (token === ',' && depth === 0) pieces.push('')
    else pieces[pieces.length - 1] += token
  }
  return pieces.map(piece => piece.trim()).filter(Boolean)
}

/** Each report note can name several capabilities; retain state direction and catch qualifiers on each. */
export function capabilityItems(kind, values) {
  const items = values.flatMap(value => {
    const prefix = kind === 'state' ? (/^(reads|writes) /.exec(value)?.[0] ?? '') : ''
    const suffix = kind === 'gating' ? (/ (?:with|without) \.catch$/.exec(value)?.[0] ?? '') : ''
    const list = value.slice(prefix.length, value.length - suffix.length)
    return splitCapabilities(list).map(item => `${prefix}${item}${suffix}`)
  })
  return [...new Set(items)]
}

function capabilityList(label, values) {
  if (values.length === 0) return null
  return el(
    'section',
    {},
    el('h4', {}, `${label} (${values.length})`),
    el(
      'ul',
      {},
      values.map(value => el('li', {}, el('code', {}, value))),
    ),
  )
}

function declaredCapabilities(facts) {
  if (!facts) return el('p', { class: 'muted' }, 'Declared capabilities are unavailable.')
  const groups = ['hooks', 'calls', 'answers', 'gating', 'state'].map(label => [
    label,
    capabilityItems(label, facts[label]),
  ])
  const present = groups.filter(([, values]) => values.length > 0)
  if (present.length === 0) return el('p', { class: 'muted' }, 'No declared capabilities.')
  return el(
    'details',
    { class: 'mod-details' },
    el(
      'summary',
      {},
      'Declared capabilities ',
      el(
        'span',
        { class: 'mod-counts muted' },
        present.map(([label, values]) => `${values.length} ${label}`).join(' · '),
      ),
    ),
    el(
      'div',
      { class: 'mod-capabilities' },
      present.map(([label, values]) => capabilityList(label, values)),
    ),
  )
}

function observedCapabilities(seen) {
  if (seen.inChains.length === 0 && seen.called.length === 0)
    return el('p', { class: 'muted mod-observed-empty' }, 'No activity observed in this session.')
  return el(
    'details',
    { class: 'mod-details' },
    el(
      'summary',
      {},
      'Observed in this session ',
      el(
        'span',
        { class: 'mod-counts muted' },
        `${seen.inChains.length} chain events · ${seen.called.length} call events`,
      ),
    ),
    el(
      'div',
      { class: 'mod-capabilities' },
      capabilityList('Answered in traced chains', seen.inChains),
      capabilityList('Calls recorded by intercepts', seen.called),
    ),
  )
}

function validationStatus(mod) {
  if (mod.problem) return el('span', { class: 'error' }, 'validation unavailable')
  if (!mod.validation) return el('span', { class: 'muted' }, 'not validated')
  return mod.validation.ok
    ? el('span', { class: 'ok' }, 'validation passed')
    : el('span', { class: 'error' }, 'validation failed')
}

function modCard(state, mod) {
  const enabled = mod.enabled === null ? 'enabled state unknown' : mod.enabled ? 'enabled' : 'disabled'
  return el(
    'article',
    { class: 'run mod-card' },
    el(
      'header',
      { class: 'mod-heading' },
      el('strong', {}, mod.id),
      el('span', { class: 'mod-status' }, enabled, ' · ', validationStatus(mod)),
    ),
    el('p', { class: 'muted mod-source' }, `${mod.source}${mod.version ? ` · ${mod.version}` : ''}`),
    mod.problem ? el('p', { class: 'error' }, mod.problem) : null,
    mod.validation && !mod.validation.ok
      ? el(
          'ul',
          { class: 'error' },
          mod.validation.errors.map(error => el('li', {}, error)),
        )
      : null,
    declaredCapabilities(mod.validation?.facts),
    observedCapabilities(observedOf(state, mod.name)),
  )
}

export async function modsPage(ctx, fresh = false) {
  const { state } = ctx
  const page = el(
    'div',
    { class: 'page' },
    pageHead('Installed mods'),
    el('p', { class: 'muted' }, 'reading every hooks module with claude plugin validate'),
  )
  try {
    const { at, mods } = await api(`/api/anatomy${fresh ? '?fresh=1' : ''}`)
    const isMod = mods.filter(mod => mod.isMod)
    const others = mods.filter(mod => !mod.isMod)
    const readAgain = el(
      'button',
      {
        type: 'button',
        class: 'quiet',
        onclick: async () => document.getElementById('main').replaceChildren(await modsPage(ctx, true)),
      },
      'Read again',
    )
    page.replaceChildren(
      pageHead('Installed mods'),
      lede(
        'What the validator reads in each hooks module on this machine, and what this session showed each mod doing.',
      ),
      readings(
        `${isMod.length} mod${isMod.length === 1 ? '' : 's'}`,
        { aside: el('span', { class: 'muted' }, `read at ${clockTime(at)} `, readAgain) },
        ...isMod.map(mod => modCard(state, mod)),
        others.length === 0
          ? null
          : el('p', { class: 'muted' }, `Plugins without a hooks module: ${others.map(mod => mod.id).join(', ')}.`),
      ),
      notes(
        "claude plugin validate reads the mods installed, the repository's own and the workshop's: the hooks each registers, the state it declares and what it calls. Beside each is what this session showed it doing: the events where it was a link in a traced chain, and the calls of its that an intercept recorded.",
      ),
    )
  } catch (error) {
    page.replaceChildren(pageHead('Installed mods'), el('p', { class: 'error' }, error.message))
  }
  return page
}
