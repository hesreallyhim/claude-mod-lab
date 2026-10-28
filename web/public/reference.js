// The $ reference: lookups in the catalog, the lines that link a page to the
// other areas, and the pages for a method on $, an engine event and a declared
// type. A method's and an event's page are a sheet in two columns: on the left
// what the declarations say (the signature, the doc text, parameters, returns,
// remarks, examples), on the right the bench, what the connected session does
// with it (the probe, the intercept, the runs, the rows seen). The left column's
// index is tree.js; the area's first page is overview.js.

import { api } from './api.js'
import { pagesShowing, USES } from './areas.js'
import { traceRow } from './feed.js'
import { interceptForm, interceptState } from './intercepts.js'
import { probeForm, probesHint, runCard } from './runs.js'
import { docText, el, linkedCode } from './view.js'

export { apiPage } from './overview.js'
export { renderTree } from './tree.js'

// Reference lookups

export function memberOf(state, id) {
  const [noun, name] = id.split('.')
  const found = state.catalog?.nouns.find(one => one.name === noun)?.members.find(one => one.name === name)
  return found === undefined ? undefined : { noun, member: found }
}

function eventOf(state, name) {
  return state.catalog?.events.find(one => one.name === name)
}

/** A dispatch's event links to its method on $ when there is one, else to the event. */
export function hrefFor(state, event) {
  if (memberOf(state, event) !== undefined) return `#/$/${event}`
  if (eventOf(state, event) !== undefined) return `#/event/${event}`
  return null
}

export function probesFor(state, event) {
  return (state.session?.probes ?? []).filter(probe => probe.calls.includes(event) || probe.id === event)
}

/** The members on $ whose call raises an event, as `noun.member`. */
function raisersOf(state, event) {
  return (state.catalog?.nouns ?? []).flatMap(noun =>
    noun.members.filter(member => member.event === event).map(member => `${noun.name}.${member.name}`),
  )
}

// Parts of a page

/** A titled part of a page, left out when it has nothing to show. */
export function section(title, ...children) {
  const body = children.flat().filter(Boolean)
  return body.length === 0 ? null : el('section', {}, el('h2', {}, title), body)
}

/** A part of the bench: always drawn, with what it holds or a line saying why it holds nothing. */
function benchPart(title, empty, ...children) {
  const body = children.flat().filter(Boolean)
  return el(
    'section',
    { class: 'bench-part' },
    el('h2', {}, title),
    body.length === 0 ? el('p', { class: 'empty' }, empty) : body,
  )
}

/** The bench's head: what it is, and the session it works in. */
function benchHead(state) {
  const session = state.session
  const id = String(session?.facts.id ?? '').slice(0, 8)
  const where =
    session === null ? 'no session connected' : session.isConnected ? `in session ${id}` : `session ${id} not polling`
  return el(
    'div',
    { class: 'bench-head' },
    el('span', { class: 'bench-title' }, 'Bench'),
    el('span', { class: 'bench-where', 'data-state': session?.isConnected ? 'on' : 'off' }, where),
  )
}

/** The reference's provenance belongs at the foot; its title already identifies the page. */
export function manLine(state, _name, _section, isFoot = false) {
  if (!isFoot) return null
  const version = state.catalog?.version
  return el('p', { class: 'man-line foot' }, version ? `Reference for Claude Code ${version}` : 'Claude Code reference')
}

/**
 * An older run as one log line, its header, that opens to the whole entry: the
 * newest run is shown in full, and the pane keeps the intercept in view.
 */
function foldedRun(state, run) {
  const card = runCard(state, run)
  const header = card.querySelector('header')
  const rest = [...card.childNodes].filter(node => node !== header)
  card.classList.add('folded')
  card.replaceChildren(el('details', {}, el('summary', {}, header), rest))
  return card
}

/** The head every reference page shares: a kicker naming what kind of thing it is, the title, and its tags. */
function sheetHead(kicker, title, tags, ...rest) {
  return el(
    'header',
    { class: 'sheet-head' },
    el('p', { class: 'kicker' }, kicker),
    el('h1', {}, title),
    tags.filter(Boolean).length === 0 ? null : el('ul', { class: 'tags' }, tags),
    rest,
  )
}

function tag(kind, ...children) {
  return el('li', { class: `tag ${kind}` }, children)
}

/** A probe marker: the run glyph the index and the tags share. */
export function probeMark() {
  return el('span', { class: 'probe-mark', role: 'img', 'aria-label': 'has a probe', title: 'has a probe' })
}

/** A block of code with a label above it, as a figure. */
function formula(label, ...blocks) {
  return el('figure', { class: 'formula' }, el('figcaption', {}, label), blocks)
}

// Cross-links

/** On a Session page: the parts of $ it shows, each linked to its reference page. */
export function usesLine(state, page) {
  const links = (USES[page] ?? []).flatMap(name => {
    const href = hrefFor(state, name)
    return href === null ? [] : [el('a', { href }, el('code', {}, name))]
  })
  return links.length === 0 ? null : el('p', { class: 'cross' }, 'Mod API: ', joined(links))
}

/** On a method's or an event's page: the Session pages that show it live. */
export function seenOnLine(name) {
  const pages = pagesShowing(name).map(([page, label]) => el('a', { href: `#/${page}` }, label))
  return pages.length === 0 ? null : el('p', { class: 'cross' }, 'Shown live in Session: ', joined(pages))
}

function joined(nodes) {
  return nodes.map((node, index) => [index > 0 ? ', ' : null, node])
}

function isInterceptable(state, member) {
  return member.eventKind === 'op' && (state.session?.interceptable ?? []).includes(member.event)
}

// Pages

const KIND_TAGS = { op: 'op call', engine: 'engine event' }

function kindSentence(member) {
  if (member.eventKind === 'op') return `A call on $ the host serves: each call dispatches the event ${member.event}.`
  if (member.eventKind === 'engine')
    return `Raises the engine event ${member.event}, the same one the engine raises at its own call site.`
  return member.kind === 'method' ? 'Not dispatched as an event.' : 'Plain data on $, read without a dispatch.'
}

export function memberPage(ctx, id) {
  const { state } = ctx
  const found = memberOf(state, id)
  if (found === undefined) return el('div', { class: 'page sheet' }, el('h1', {}, `Nothing on $ is named ${id}.`))
  const { noun, member } = found
  const names = state.typeNames
  const isMethod = member.kind === 'method'
  const probes = probesFor(state, id)
  const recent = state.runs
    .filter(run => probes.some(probe => probe.id === run.probe))
    .slice(-3)
    .reverse()
  const event = member.event
  const tags = [
    tag('what', KIND_TAGS[member.eventKind] ?? (isMethod ? 'method' : 'data')),
    event
      ? tag(
          'event',
          'dispatches ',
          eventOf(state, event) ? el('a', { href: `#/event/${event}` }, el('code', {}, event)) : el('code', {}, event),
        )
      : null,
    probes.length > 0
      ? tag('probe', probeMark(), `probe (${[...new Set(probes.map(probe => probe.effect))].join(', ')})`)
      : tag('none', 'no probe'),
    isInterceptable(state, member) ? tag('intercept', 'interceptable') : null,
    member.deprecated ? tag('deprecated', 'deprecated') : null,
  ]
  const interceptable = isInterceptable(state, member)
  const bench =
    probes.length === 0 && !interceptable && recent.length === 0
      ? el(
          'p',
          { class: 'empty' },
          `Nothing to run here: no probe in mods/mod-lab/hooks/probes.ts calls $.${id}, and the lab does not intercept its event.`,
        )
      : [
          benchPart(
            'Run it in the session',
            `No probe calls $.${id}.`,
            probesHint(state),
            probes.map(probe => probeForm(state, probe)),
          ),
          // The runs follow the form that makes them; the intercept, which changes what the next run meets, comes after.
          benchPart(
            'Recent runs',
            'No runs of its probe yet.',
            recent.map((run, index) => (index === 0 ? runCard(state, run) : foldedRun(state, run))),
          ),
          interceptable
            ? benchPart('Intercept it', '', interceptState(state, event), interceptForm(state, event))
            : null,
        ]
  return el(
    'div',
    { class: 'page sheet' },
    el(
      'div',
      { class: 'sheet-body' },
      el(
        'div',
        { class: 'datasheet' },
        manLine(state, id, '3'),
        sheetHead(
          [isMethod ? 'Method' : 'Property', ' on ', el('code', {}, `$.${noun}`)],
          el('code', {}, el('span', { class: 'dim' }, `$.${noun}.`), member.name, isMethod ? '()' : null),
          tags,
          el('p', { class: 'kind' }, kindSentence(member)),
        ),
        formula(
          'Signature',
          el('pre', { class: 'signature' }, linkedCode(member.signature, names)),
          member.resolved ? el('pre', { class: 'signature resolved' }, linkedCode(member.resolved, names)) : null,
        ),
        member.deprecated ? el('p', { class: 'deprecated' }, `Deprecated: ${member.deprecated}`) : null,
        member.text ? section('Description', el('div', { class: 'doc' }, docText(member.text, names))) : null,
        section(
          'Parameters',
          member.params.length === 0
            ? null
            : el(
                'dl',
                { class: 'params' },
                member.params.map(param => [
                  el('dt', {}, el('code', {}, param.name)),
                  el('dd', {}, docText(param.text, names)),
                ]),
              ),
        ),
        section('Returns', member.returns ? docText(member.returns, names) : null),
        section('Remarks', member.remarks ? docText(member.remarks, names) : null),
        section(
          'Examples',
          member.examples.map(example => el('pre', {}, el('code', {}, example))),
        ),
        manLine(state, id, '3', true),
      ),
      el('aside', { class: 'bench', 'aria-label': 'Bench' }, benchHead(state), bench),
    ),
  )
}

export function eventPage(ctx, name) {
  const { state } = ctx
  const event = eventOf(state, name)
  if (event === undefined) return el('div', { class: 'page sheet' }, el('h1', {}, `No event is named ${name}.`))
  const names = state.typeNames
  const seen = state.traces
    .filter(row => row.event === name)
    .slice(-10)
    .reverse()
  const raisers = raisersOf(state, name)
  const rest = name.startsWith(`${event.namespace}.`) ? name.slice(event.namespace.length + 1) : null
  return el(
    'div',
    { class: 'page sheet' },
    el(
      'div',
      { class: 'sheet-body' },
      el(
        'div',
        { class: 'datasheet' },
        manLine(state, name, '3hook'),
        sheetHead(
          ['Engine event in ', el('code', {}, event.namespace)],
          el('code', {}, rest === null ? name : [el('span', { class: 'dim' }, `${event.namespace}.`), rest]),
          [
            tag('what', 'engine event'),
            event.isStreaming ? tag('streaming', 'streaming: the hook is an async generator') : null,
            raisers.length === 0
              ? null
              : tag(
                  'event',
                  'raised by ',
                  joined(raisers.map(id => el('a', { href: `#/$/${id}` }, el('code', {}, `$.${id}()`)))),
                ),
          ],
        ),
        formula(
          'Hook',
          el('pre', { class: 'signature' }, `on('${name}', ($, e, next) => …)`),
          el(
            'dl',
            { class: 'types' },
            el('dt', {}, el('code', {}, 'e')),
            el('dd', {}, linkedCode(event.input, names)),
            event.result
              ? [el('dt', {}, el('code', {}, 'next(e)')), el('dd', {}, linkedCode(event.result, names))]
              : null,
          ),
        ),
        event.text ? section('Description', el('div', { class: 'doc' }, docText(event.text, names))) : null,
        section('Remarks', event.remarks ? docText(event.remarks, names) : null),
        section(
          'Examples',
          event.examples.map(example => el('pre', {}, el('code', {}, example))),
        ),
        manLine(state, name, '3hook', true),
      ),
      el(
        'aside',
        { class: 'bench', 'aria-label': 'Bench' },
        benchHead(state),
        benchPart(
          'Seen in this session',
          'Not yet. The lab traces prompt.submit, tool.call, command.run, turn.start, turn.complete and session.start.',
          seen.map(row => traceRow(state, row)),
        ),
      ),
    ),
  )
}

export async function typePage(ctx, name) {
  const { state } = ctx
  const head = (...rest) => sheetHead('Declared type', el('code', {}, name), [], rest)
  const man = () => manLine(state, name, '3type')
  const page = el('div', { class: 'page sheet single' }, man(), head(), el('p', { class: 'muted' }, 'loading'))
  try {
    const type = await api(`/api/type?name=${encodeURIComponent(name)}`)
    page.replaceChildren(
      man(),
      head(
        el(
          'p',
          { class: 'kind' },
          `Declared in ${type.module === 'global' ? 'the global scope' : `'${type.module}'`}.`,
        ),
      ),
      el('div', { class: 'doc' }, docText(type.text, state.typeNames)),
      formula('Declaration', el('pre', { class: 'declaration' }, linkedCode(type.source, state.typeNames))),
      manLine(state, name, '3type', true),
    )
  } catch (error) {
    page.replaceChildren(man(), head(), el('p', { class: 'error' }, error.message))
  }
  return page
}
