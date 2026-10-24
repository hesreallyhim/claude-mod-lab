// The left column. In the Mod API area it is the reference's index: the area's
// two pages, then the nouns on $ with their members, then the engine events by
// namespace, each group with its count, a run glyph on each member a probe
// calls, and a line above saying how much of the reference the filter shows.
// In the other areas it lists the area's pages.

import { AREAS, areaOf, routeOf } from './areas.js'
import { probeMark, probesFor } from './reference.js'
import { el } from './view.js'

/** What the filter compares: the text typed, without a leading `$.` (people type `$.fs` as they read it). */
function needle(state) {
  return state.filter.replace(/^\$\.?/, '')
}

function matches(state, text) {
  const wanted = needle(state)
  return wanted === '' || text.toLowerCase().includes(wanted)
}

/** Sets the filter as if typed, and narrows the index to it. */
export function setFilter(state, text) {
  const search = /** @type {HTMLInputElement | null} */ (document.getElementById('search'))
  if (search !== null) search.value = text
  state.filter = text.trim().toLowerCase()
  renderTree(state)
}

function groupHead(label, count) {
  return el('h3', {}, el('span', { class: 'group-name' }, label), el('span', { class: 'count' }, String(count)))
}

/** The nouns and events the filter lets through, and how many entries the reference has in all. */
function narrowed(state) {
  const catalog = state.catalog
  // Nouns and namespaces in alphabetical order, for looking one up; members and events keep the
  // declarations' order, which follows a lifecycle (turn.start, turn.step, turn.complete).
  const nouns = (catalog?.nouns ?? [])
    .map(noun => ({ noun, members: noun.members.filter(member => matches(state, `${noun.name}.${member.name}`)) }))
    .filter(one => one.members.length > 0)
    .sort((a, b) => a.noun.name.localeCompare(b.noun.name))
  const grouped = new Map()
  for (const event of catalog?.events ?? []) {
    if (!matches(state, event.name)) continue
    grouped.set(event.namespace, [...(grouped.get(event.namespace) ?? []), event])
  }
  const namespaces = new Map([...grouped].sort(([a], [b]) => a.localeCompare(b)))
  const total =
    (catalog?.nouns ?? []).reduce((sum, noun) => sum + noun.members.length, 0) + (catalog?.events.length ?? 0)
  const shown =
    nouns.reduce((sum, one) => sum + one.members.length, 0) +
    [...namespaces.values()].reduce((sum, events) => sum + events.length, 0)
  return { nouns, namespaces, total, shown }
}

function renderCount(state, total, shown) {
  const count = document.getElementById('tree-count')
  if (count === null) return
  if (state.catalog === null) count.replaceChildren(state.catalogError ?? 'loading the reference')
  else if (state.filter === '') count.replaceChildren(`${total} entries · `, probeMark(), ' runs from its page')
  else count.replaceChildren(`${shown} of ${total} entries match`)
}

export function renderTree(state) {
  const tree = document.getElementById('tree')
  const route = location.hash
  const link = (href, label, extra) =>
    el(
      'a',
      { href, class: route === href ? 'current' : null, 'aria-current': route === href ? 'page' : null },
      label,
      extra ?? null,
    )
  const area = areaOf(routeOf(route).kind)
  document.getElementById('nav')?.setAttribute('aria-label', area === 'api' ? 'Reference' : 'Pages')
  if (area !== 'api') {
    const pages = AREAS.find(one => one.id === area)?.pages ?? []
    tree.replaceChildren(
      el(
        'div',
        { class: 'group' },
        pages.map(([page, label]) => link(`#/${page}`, label)),
      ),
    )
    return
  }
  const { nouns, namespaces, total, shown } = narrowed(state)
  renderCount(state, total, shown)
  const groups = [el('div', { class: 'group pages' }, link('#/api', 'What $ is'), link('#/probes', 'All probes'))]
  if (nouns.length > 0) groups.push(el('h2', { class: 'tree-section' }, 'Nouns on $'))
  for (const { noun, members } of nouns) {
    groups.push(
      el(
        'div',
        { class: 'group noun' },
        groupHead(`$.${noun.name}`, members.length),
        members.map(member => {
          const id = `${noun.name}.${member.name}`
          return link(
            `#/$/${id}`,
            el(
              'span',
              { class: 'name' },
              member.name,
              member.kind === 'method' ? el('span', { class: 'parens' }, '()') : null,
            ),
            probesFor(state, id).length > 0 ? probeMark() : null,
          )
        }),
      ),
    )
  }
  if (namespaces.size > 0) groups.push(el('h2', { class: 'tree-section' }, "Events · on('…')"))
  for (const [namespace, events] of namespaces) {
    groups.push(
      el(
        'div',
        { class: 'group events' },
        groupHead(namespace, events.length),
        events.map(event => {
          const rest = event.name.startsWith(`${namespace}.`) ? event.name.slice(namespace.length + 1) : null
          return link(
            `#/event/${event.name}`,
            el(
              'span',
              { class: 'name' },
              rest === null ? event.name : [el('span', { class: 'ns' }, `${namespace}.`), rest],
            ),
          )
        }),
      ),
    )
  }
  if (state.catalog !== null && shown === 0)
    groups.push(el('p', { class: 'empty' }, `Nothing on $ or among the events matches “${state.filter}”.`))
  tree.replaceChildren(...groups)
}
