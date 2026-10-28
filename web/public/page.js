// The anatomy every page outside the Mod API shares:
// a lede saying what the page shows, a framed box of controls that act on the
// session, readings under a heading, and guidance beside the relevant title.
// A command's text answer is drawn as a report rather than raw text.

import { el, openContentDialog } from './view.js'

/** The models a call can name, as the lab's probes offer them; the forms that take a model pick from this list. */
export const MODELS = ['haiku', 'sonnet', 'opus']

/** One sentence under the title: what the page shows. */
export function lede(...children) {
  return el('p', { class: 'lede' }, children)
}

/** Controls that act on the session: one framed box, its title in the edge, its answers beneath its fields. */
export function controls(title, ...children) {
  return el('section', { class: 'controls framed' }, el('h2', { class: 'frame-title' }, title), children)
}

/** What the session shows: a heading with anything for its right (a filter, a switch), then the body. */
export function readings(title, { aside = null } = {}, ...children) {
  return el(
    'section',
    { class: 'readings' },
    el('div', { class: 'readings-head' }, el('h2', {}, title), aside),
    children,
  )
}

/** Page guidance, placed beside its heading. */
export function notes(...paragraphs) {
  return helpButton('How it works', ...paragraphs)
}

/** Guidance opens separately so reading it never moves the controls or data. */
export function helpButton(title, ...paragraphs) {
  const content = el(
    'div',
    { class: 'help-content' },
    paragraphs.map(paragraph => (typeof paragraph === 'string' ? el('p', {}, paragraph) : paragraph)),
  )
  return el(
    'button',
    {
      type: 'button',
      class: 'quiet help-button',
      'aria-haspopup': 'dialog',
      onclick: () => openContentDialog(title, content),
    },
    title,
  )
}

/** Optional working sections, including forms, stay in the normal page flow. */
export function titledNotes(title, ...paragraphs) {
  return el(
    'details',
    { class: 'notes' },
    el('summary', {}, title),
    paragraphs.map(paragraph => (typeof paragraph === 'string' ? el('p', {}, paragraph) : paragraph)),
  )
}

/** A select over the models, `picked` chosen. */
export function modelSelect(name, picked = 'haiku') {
  return el(
    'select',
    { name },
    MODELS.map(model => el('option', { value: model, selected: model === picked }, model)),
  )
}

const CELL_GAP = /\s{2,}/

/**
 * A command's answer as a report. Blocks are split by blank lines; a block whose
 * first line ends in a colon is headed by it. Lines with columns (two or more
 * spaces between them) make a table, a line without columns spanning the row;
 * lines of items joined by " · " are laid out as items; the rest are paragraphs.
 */
export function reportView(text) {
  const blocks = String(text)
    .trim()
    .split(/\n\s*\n/)
  return el(
    'div',
    { class: 'answer report' },
    blocks.map(block => {
      const lines = block.split('\n')
      const first = (lines[0] ?? '').trim()
      const isHeaded = first.endsWith(':') && lines.length > 1
      const rows = (isHeaded ? lines.slice(1) : lines).map(line => line.trim()).filter(Boolean)
      const cells = rows.map(line => line.split(CELL_GAP))
      const widest = Math.max(1, ...cells.map(row => row.length))
      let body
      if (widest > 1)
        body = el(
          'table',
          { class: 'facts report-table' },
          el(
            'tbody',
            {},
            cells.map(row =>
              el(
                'tr',
                {},
                row.map((cell, index) =>
                  el(
                    'td',
                    { colspan: row.length === 1 ? widest : index === row.length - 1 ? widest - index : null },
                    cell,
                  ),
                ),
              ),
            ),
          ),
        )
      else if (rows.length > 0 && rows.every(line => line.includes(' · ')))
        body = rows.map(line =>
          el(
            'p',
            { class: 'items' },
            line.split(' · ').map(item => el('span', { class: 'item' }, item)),
          ),
        )
      else body = rows.map(line => el('p', {}, line))
      return el('section', { class: 'report-block' }, isHeaded ? el('h3', {}, first.slice(0, -1)) : null, body)
    }),
  )
}
