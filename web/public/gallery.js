// The Gallery page: the gallery mod's techniques as cards, each a mod of its
// own to add to the session; the elements each surface draws, read from the
// engine's declarations; and how each technique works, with its source.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { componentControl, forgetComponents } from './components.js'
import { markdown } from './markdown.js'
import { el, openTextDialog } from './view.js'

const SURFACE_LABEL = { terminal: 'terminal', desktop: 'desktop', vscode: 'VS Code', mobile: 'mobile' }

const NUMBER_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
]

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Scrolls to a technique's notes and source; a hash would change the page's route. */
function showWorkings(id) {
  document
    .getElementById(`gallery-${id}`)
    ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
}

/** A technique as a card: what its mod does, where it draws, how to see it in the gallery, and Add to project. */
function card(tab) {
  return el(
    'article',
    { class: 'card technique-card' },
    el('h3', {}, tab.title),
    el('p', {}, tab.example?.description ?? ''),
    tab.example?.where ? el('p', { class: 'meta' }, `Draws on ${tab.example.where}.`) : null,
    el(
      'p',
      { class: 'uses' },
      el('code', { title: 'The same technique in the gallery mod' }, `/mod-gallery ${tab.id}`),
      el('button', { type: 'button', class: 'link more', onclick: () => showWorkings(tab.id) }, 'How it works ↓'),
    ),
    tab.example === null ? null : componentControl(tab.example.name),
  )
}

/** Every element any surface has, by row, a mark under each surface that draws it. */
function matrix(elements) {
  const rows = []
  for (const surface of elements) {
    for (const member of surface.members) if (!rows.some(row => row.name === member.name)) rows.push(member)
  }
  return el(
    'div',
    { class: 'panel matrix-wrap' },
    el(
      'table',
      { class: 'matrix' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'element'),
          ...elements.map(surface => el('th', {}, SURFACE_LABEL[surface.surface] ?? surface.surface)),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map(({ name, props }) =>
          el(
            'tr',
            { 'data-element': name },
            el(
              'td',
              {},
              props === null
                ? el('code', {}, name)
                : el('a', { href: `#/type/${props}`, title: `${props}: its props and their limits` }, name),
            ),
            ...elements.map(surface => {
              const has = surface.members.some(member => member.name === name)
              return el(
                'td',
                {
                  class: has ? 'yes' : 'no',
                  'data-surface': surface.surface,
                  'aria-label': has ? 'drawn' : 'not drawn',
                },
                has ? '✓' : '·',
              )
            }),
          ),
        ),
      ),
    ),
  )
}

/** The technique's mod as a snippet that writes it into workshop/, for someone who would rather paste than add. */
function snippetRow(example) {
  const status = el('span', { class: 'copy-status muted' })
  const copy = el(
    'button',
    {
      type: 'button',
      class: 'quiet',
      onclick: async () => {
        status.dataset.copyState = 'pending'
        try {
          await navigator.clipboard.writeText(example.snippet)
          status.dataset.copyState = 'copied'
          status.textContent = ` Copied. Paste it in a terminal in your workspace: it writes workshop/${example.name}/.`
        } catch {
          status.dataset.copyState = 'error'
          status.textContent = ' The page cannot reach the clipboard here. Open View snippet to select and copy it.'
        }
      },
    },
    'Copy as a mod',
  )
  return [
    el(
      'p',
      {},
      'A snippet that writes ',
      el('code', {}, `examples/${example.name}`),
      ' into ',
      el('code', {}, `workshop/${example.name}`),
      ', to paste rather than add.',
    ),
    el(
      'div',
      { class: 'inline-form' },
      copy,
      el(
        'button',
        {
          type: 'button',
          class: 'quiet',
          'aria-haspopup': 'dialog',
          onclick: () => openTextDialog(`${example.name} snippet`, example.snippet, 'Close snippet'),
        },
        'View snippet',
      ),
      status,
    ),
  ]
}

/** How a technique works in the gallery mod: what each surface draws, and the code that draws it. */
function workings(tab) {
  return el(
    'section',
    { class: 'panel technique', id: `gallery-${tab.id}` },
    el('header', {}, el('h3', {}, tab.title), el('code', {}, `/mod-gallery ${tab.id}`)),
    el(
      'dl',
      { class: 'pairs' },
      el('dt', {}, 'Terminal'),
      el('dd', {}, ...markdown(tab.terminal)),
      el('dt', {}, 'Desktop, VS Code, mobile'),
      el('dd', {}, ...markdown(tab.elsewhere)),
      el('dt', { title: 'Read from mods/gallery-mod as it stands' }, 'Source'),
      el(
        'dd',
        { class: 'source' },
        ...tab.excerpts.map(excerpt =>
          el(
            'div',
            { class: 'excerpt' },
            el('p', {}, `${excerpt.file}: ${excerpt.label}`),
            el(
              'button',
              {
                type: 'button',
                class: 'quiet',
                'aria-haspopup': 'dialog',
                onclick: () =>
                  openTextDialog(
                    `${excerpt.file}: ${excerpt.label}`,
                    excerpt.text ?? 'Source not found in the file.',
                    'Close source',
                  ),
              },
              'View source',
            ),
          ),
        ),
      ),
      tab.example === null
        ? null
        : [el('dt', {}, 'As a mod'), el('dd', { class: 'as-mod' }, ...snippetRow(tab.example))],
    ),
  )
}

export async function galleryPage() {
  forgetComponents()
  const { elements, tabs, problems } = await api('/api/gallery')
  return el(
    'div',
    { class: 'page gallery' },
    pageHead('Gallery'),
    el(
      'p',
      { class: 'lede' },
      `${NUMBER_WORDS[tabs.length] ?? tabs.length} ways a mod can draw beyond Box and Text. Each is a tab of the gallery mod, and a small mod of its own to add to your session or build on.`,
    ),
    el(
      'p',
      { class: 'muted' },
      'To see them side by side, add the gallery mod, which has every technique as a tab of one pane, and open a tab, such as ',
      el('code', {}, '/mod-gallery raster'),
      '.',
    ),
    componentControl('gallery-mod'),
    ...problems.map(problem => el('p', { class: 'error' }, problem)),
    el('h2', {}, 'Techniques'),
    el(
      'p',
      {},
      'Add to lab copies an example into ',
      el('code', {}, '~/.claude-mod-lab/examples/'),
      ', shared by your lab sessions. Run its command to activate it in the session you want to try it in. Start the lab with ',
      el('code', {}, 'run --local'),
      ' to load project copies made with Add to project in ',
      el('code', {}, '.claude/mod-lab/'),
      ' instead. Each example shows its destination and how to try it.',
    ),
    el('div', { class: 'cards list' }, ...tabs.map(card)),
    el('h2', {}, 'What each surface draws'),
    el(
      'p',
      {},
      "The elements each surface has, as your Claude Code's declarations say. An element links to its props: what it takes, and its limits.",
    ),
    elements.length === 0
      ? el('p', { class: 'muted' }, 'The declarations were not found, so the surfaces are not shown.')
      : matrix(elements),
    el('h2', {}, 'How each one works'),
    el(
      'p',
      {},
      "The gallery mod's version of each technique: what it draws on each surface, and the code that draws it, read from mods/gallery-mod as it stands.",
    ),
    ...tabs.map(workings),
  )
}
