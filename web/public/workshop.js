// The Workshop page: the mods in the workspace's workshop/, every one of which
// the lab's session loads, each with a switch that turns it off for this
// workspace and has the session reload. A lesson's mod links to its lessons,
// and says beside its switch when the lesson's steps have it make model calls
// or play sound.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { lede, notes, readings } from './page.js'
import { el } from './view.js'
import { lessonLocation, lessonSetup } from './lesson-setup.js'

/** One mod's row: its switch, its name and description, its lessons and what they say it does. */
function modRow(mod, lessonWorkspace) {
  const note = el('span', { class: 'muted' })
  const label = el('span', {}, mod.isOn ? 'on' : 'off')
  const toggle = el('input', { type: 'checkbox', role: 'switch', checked: mod.isOn, 'aria-label': `${mod.name} on` })
  toggle.addEventListener('change', async () => {
    const isOn = toggle.checked
    toggle.disabled = true
    note.className = 'muted'
    note.textContent = isOn ? 'turning on' : 'turning off'
    try {
      const answer = await api('/api/workshop/switch', {
        method: 'POST',
        body: JSON.stringify({ name: mod.name, isOn, lessonWorkspace }),
      })
      toggle.checked = answer.mod.isOn
      note.textContent = answer.reload.note
    } catch (error) {
      toggle.checked = !isOn
      note.className = 'error'
      note.textContent = error.message
    } finally {
      toggle.disabled = false
      label.textContent = toggle.checked ? 'on' : 'off'
    }
  })
  const lessons = mod.lessons.flatMap((lesson, index) => [
    index === 0 ? null : ', ',
    el('a', { href: `#/learn/${lesson.id}` }, lesson.id),
  ])
  return el(
    'tr',
    { 'data-mod': mod.name },
    el(
      'td',
      {},
      el('label', { class: 'switch' }, toggle, ' ', label),
      mod.effects.length === 0 ? null : el('div', { class: 'effects' }, mod.effects.join(', ')),
    ),
    el(
      'td',
      { class: 'preview' },
      el('code', {}, mod.name),
      mod.folder === mod.name ? null : el('span', { class: 'muted' }, ` in workshop/${mod.folder}`),
      mod.folder === 'sandbox-mod' ? [' ', el('a', { href: '#/sandbox' }, 'Sandbox')] : null,
      mod.description === '' ? null : el('div', { class: 'muted' }, mod.description),
      el('div', {}, note),
    ),
    el('td', {}, lessons),
  )
}

export async function workshopPage() {
  const page = el(
    'div',
    { class: 'page' },
    pageHead('Workshop'),
    lede(
      'Mods in your lesson workspace, including those you build in ',
      el('a', { href: '#/learn' }, 'Lessons'),
      ' or save from the ',
      el('a', { href: '#/sandbox' }, 'Sandbox'),
      '. Turn them on or off here, even while you’re still working through a lesson.',
    ),
  )
  try {
    const { settings, mods, lessonWorkspace } = await api('/api/workshop')
    if (!lessonWorkspace) {
      page.append(lessonSetup())
      return page
    }
    page.append(
      lessonLocation(lessonWorkspace),
      readings(
        'Mods',
        {},
        mods.length === 0
          ? el(
              'p',
              { class: 'muted' },
              "No mods yet: a lesson's page starts its mod here, and the Sandbox's Save makes sandbox-mod.",
            )
          : el(
              'table',
              { class: 'rows workshop' },
              el('thead', {}, el('tr', {}, el('th', {}, 'loaded'), el('th', {}, 'mod'), el('th', {}, 'lessons'))),
              el(
                'tbody',
                {},
                mods.map(mod => modRow(mod, lessonWorkspace)),
              ),
            ),
      ),
      notes(
        el(
          'p',
          {},
          'A switch turns a mod off for this workspace, with ',
          el('code', {}, '"<name>@inline": false'),
          ' in ',
          el('code', {}, settings),
          ', and has the session reload. Turned on again, the setting is removed.',
        ),
      ),
    )
  } catch (error) {
    page.append(el('p', { class: 'error' }, error.message))
  }
  return page
}
