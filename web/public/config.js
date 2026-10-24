// Settings: every /config row of the session by the plugin or engine that owns
// it, as the lab last read them, and a row set through /mod-lab config set, which
// writes the person's settings as /config does.

import { pageHead } from './areas.js'
import { controls, lede, notes, readings } from './page.js'
import { el } from './view.js'

let filter = ''

/** A setting's identity stays visible while its longer explanation can be opened. */
function settingName(row) {
  return el(
    'th',
    { scope: 'row', 'data-label': 'Setting' },
    el('code', { class: 'config-key' }, row.key),
    el('span', { class: 'config-label' }, row.label),
    row.description
      ? el('details', { class: 'config-description' }, el('summary', {}, 'Description'), el('p', {}, row.description))
      : null,
  )
}

function settingKind(row) {
  const options = row.options ?? []
  return el(
    'td',
    { 'data-label': 'Kind' },
    row.kind,
    options.length === 0
      ? null
      : el(
          'details',
          { class: 'config-options' },
          el('summary', {}, `${options.length} choices`),
          el(
            'ul',
            {},
            options.map(option => el('li', {}, el('code', {}, option))),
          ),
        ),
  )
}

function settingValue(row) {
  return el(
    'td',
    { 'data-label': 'Value' },
    el('code', { class: 'config-value' }, row.kind === 'text' ? JSON.stringify(row.value) : String(row.value)),
    row.isLocked
      ? el(
          'span',
          { class: 'config-lock muted', title: 'A trusted source, managed settings or a policy, owns the value.' },
          'locked',
        )
      : null,
  )
}

function rowsTables(rows) {
  const shown = rows.filter(
    row => filter === '' || `${row.key} ${row.label} ${row.provider}`.toLowerCase().includes(filter),
  )
  if (rows.length === 0) return [el('p', { class: 'muted' }, 'Not read yet: press Read the settings.')]
  if (shown.length === 0) return [el('p', { class: 'muted' }, 'No row matches.')]
  const byProvider = new Map()
  for (const row of shown) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row])
  return [...byProvider].flatMap(([provider, owned]) => [
    el('h3', {}, `${provider}: ${owned.length} row${owned.length === 1 ? '' : 's'}`),
    el(
      'table',
      { class: 'facts rows config-rows' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ['Setting', 'Kind', 'Value'].map(label => el('th', { scope: 'col' }, label)),
        ),
      ),
      el(
        'tbody',
        {},
        owned.map(row => el('tr', {}, settingName(row), settingKind(row), settingValue(row))),
      ),
    ),
  ])
}

/** Redraws the live part in place, leaving the forms as typed. */
export function refreshConfig(state) {
  const live = document.querySelector('[data-live="config"]')
  if (live === null) return
  live.replaceChildren(...rowsTables(state.mirror.config))
  const keys = document.getElementById('config-keys')
  keys?.replaceChildren(...state.mirror.config.map(row => el('option', { value: row.key })))
}

/** `ctx`: the page's `state` and `sendCommand(text, target)`. */
export function configPage(ctx) {
  const { state, sendCommand } = ctx
  const status = el('div', { class: 'result' })
  // The command's answer repeats the tables below; its first line is enough here.
  const readStatus = el('div', { class: 'result brief' })
  const read = el(
    'button',
    { type: 'button', onclick: () => void sendCommand('config', readStatus) },
    'Read the settings',
  )
  const search = el('input', {
    placeholder: 'filter by key, label or owner',
    value: filter,
    oninput: event => {
      filter = event.currentTarget.value.trim().toLowerCase()
      refreshConfig(state)
    },
  })
  const set = el(
    'form',
    {
      class: 'inline-form',
      onsubmit: event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const key = String(data.get('key') ?? '').trim()
        if (key !== '') void sendCommand(`config set ${key} ${String(data.get('value') ?? '')}`, status)
      },
    },
    el('input', { name: 'key', list: 'config-keys', placeholder: "key, as plugin.field or the menu's id" }),
    el('datalist', { id: 'config-keys' }),
    el('input', { name: 'value', placeholder: 'true, false, a number, or text' }),
    el('button', { type: 'submit' }, 'Set'),
  )
  queueMicrotask(() => refreshConfig(state))
  return el(
    'div',
    { class: 'page' },
    pageHead('Settings'),
    lede("Every row of the /config menu, the engine's own and each plugin's, as the lab last read them."),
    controls(
      'Read and set',
      el(
        'p',
        {},
        "Read the rows as $.config.list() answers them; set one as /config would, through every plugin's config.set hook.",
      ),
      el('div', { class: 'inline-form' }, read, search),
      readStatus,
      set,
      status,
    ),
    readings('Rows, by owner', {}, el('div', { 'data-live': 'config' })),
    notes(
      "Each row has a key, label, kind and value, and may be locked by a trusted source. A plugin's fields arrive in its register(on, options), fixed while it is loaded; changing one reloads the plugin.",
      'A config.set hook sees each change on its way and may clamp it or refuse it with a reason, and config.describe may relabel or hide a row. The lab reads the rows when asked and after each change it sees.',
    ),
  )
}
