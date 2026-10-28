// The Sandbox page: one mod, workshop/sandbox-mod, edited here, its module,
// its contract and a test. Save writes them and shows what the validator reads
// in the module and tsc's errors at their lines; Run tests runs its tests.

import { api } from './api.js'
import { pageHead } from './areas.js'
import { controls, lede, notes } from './page.js'
import { el, textPreview } from './view.js'
import { lessonLocation, lessonSetup } from './lesson-setup.js'

const ROLES = [
  ['module', 'hooks/register.tsx'],
  ['contract', 'types/index.d.ts'],
  ['test', 'tests/sandbox.test.ts'],
]

/** A textarea with its line numbers beside it, kept in step as it grows and scrolls. */
function editor(path, text) {
  const gutter = el('pre', { class: 'gutter', 'aria-hidden': 'true' })
  const area = el('textarea', { spellcheck: 'false', wrap: 'off', 'aria-label': path })
  const number = () => {
    gutter.textContent = Array.from({ length: area.value.split('\n').length }, (_, index) => index + 1).join('\n')
    gutter.scrollTop = area.scrollTop
  }
  area.value = text
  area.addEventListener('input', number)
  area.addEventListener('scroll', () => (gutter.scrollTop = area.scrollTop))
  number()
  const set = next => {
    area.value = next
    number()
  }
  return {
    area,
    set,
    view: el(
      'div',
      { class: 'editor' },
      el('div', { class: 'muted' }, el('code', {}, path)),
      el('div', { class: 'editor-body' }, gutter, area),
    ),
  }
}

function checkReport({ validation, types }) {
  const row = (label, values) =>
    values.length === 0 ? null : el('tr', { 'data-fact': label }, el('th', {}, label), el('td', {}, values.join('; ')))
  return el(
    'div',
    { 'data-validation': validation.ok ? 'passed' : 'failed' },
    validation.ok
      ? el('p', {}, 'The validator passes it.')
      : el(
          'div',
          {},
          el('p', { class: 'error' }, 'The validator refuses it:'),
          el(
            'ul',
            {},
            ...validation.errors.map(error => el('li', { class: 'error' }, textPreview('Validation error', error))),
          ),
        ),
    el(
      'table',
      { class: 'facts' },
      el(
        'tbody',
        {},
        row('hooks', validation.facts.hooks),
        row('calls', validation.facts.calls),
        row('gating', validation.facts.gating),
        row('state', validation.facts.state),
      ),
    ),
    !types.checked
      ? el('p', { class: 'muted' }, 'Not type-checked: the server found no claude-code.d.ts.')
      : types.errors.length === 0
        ? el('p', {}, 'TypeScript: no errors.')
        : el(
            'ul',
            {},
            ...types.errors.map(error =>
              el(
                'li',
                { class: 'error' },
                el('code', {}, `${error.file}:${error.line}:${error.column}`),
                textPreview(`TypeScript error · ${error.file}:${error.line}`, error.message),
              ),
            ),
          ),
  )
}

function testReport({ results, output }) {
  if (results.length === 0)
    return el(
      'div',
      { class: 'error' },
      el('p', {}, 'No test ran.'),
      output ? textPreview('Test output', output) : null,
    )
  return el(
    'ul',
    { class: 'tests' },
    ...results.map(result =>
      el(
        'li',
        { class: result.status === 'pass' ? 'ok' : 'error', 'data-test-status': result.status },
        `${result.status === 'pass' ? '✓' : '✗'} ${result.name}`,
        result.detail.length === 0 ? null : textPreview(`${result.name} · Details`, result.detail.join('\n')),
      ),
    ),
  )
}

export async function sandboxPage() {
  const info = await api('/api/sandbox')
  if (!info.lessonWorkspace) return el('div', { class: 'page sandbox' }, pageHead('Sandbox'), lessonSetup())
  const editors = Object.fromEntries(ROLES.map(([role, path]) => [role, editor(path, info.files[role])]))
  const files = () => Object.fromEntries(ROLES.map(([role]) => [role, editors[role].area.value]))
  const report = el('div', { class: 'result' })
  const save = async () => {
    report.replaceChildren(el('p', { class: 'muted' }, 'saving and checking'))
    const checked = await api('/api/sandbox/save', {
      method: 'POST',
      body: JSON.stringify({ files: files(), lessonWorkspace: info.lessonWorkspace }),
    })
    report.replaceChildren(checkReport(checked))
    return checked
  }
  const failed = error => report.replaceChildren(el('p', { class: 'error' }, error.message))
  const start = el(
    'select',
    { name: 'start' },
    el('option', { value: '' }, 'the blank mod'),
    ...info.examples.map(name => el('option', { value: name }, name)),
  )
  const load = async () => {
    const chosen =
      start.value === ''
        ? info.blank
        : (await api(`/api/sandbox/example?name=${encodeURIComponent(start.value)}`)).files
    for (const [role] of ROLES) editors[role].set(chosen[role])
    report.replaceChildren(
      el('p', { class: 'muted' }, `${start.value || 'The blank mod'} is in the editors, not saved yet.`),
    )
  }
  return el(
    'div',
    { class: 'page sandbox' },
    pageHead(
      'Sandbox',
      notes(
        "Save writes the files with a manifest naming the plugin sandbox-mod. The lab's session loads it from workshop/ once it is saved, and reloads it after each save, so a change shows in the session as soon as it is written.",
      ),
    ),
    lessonLocation(info.lessonWorkspace),
    lede(`One mod, ${info.dir}, edited here: its hooks module, its state contract and a test.`),
    controls(
      'Save and test',
      el(
        'p',
        {},
        "Save writes the three files and shows what the validator reads in the module, with TypeScript's errors at their lines; Run tests saves, then runs the test with claude plugin test.",
      ),
      el(
        'div',
        { class: 'inline-form' },
        el('button', { type: 'button', onclick: () => void save().catch(failed) }, 'Save'),
        el(
          'button',
          {
            type: 'button',
            class: 'quiet',
            onclick: () =>
              void save()
                .then(async checked => {
                  if (!checked.validation.ok) return
                  report.append(el('p', { class: 'muted' }, 'running the tests'))
                  const tested = await api('/api/sandbox/test', {
                    method: 'POST',
                    body: JSON.stringify({ lessonWorkspace: info.lessonWorkspace }),
                  })
                  report.lastChild?.replaceWith(testReport(tested))
                })
                .catch(failed),
          },
          'Run tests',
        ),
        el('span', { class: 'muted' }, 'Start from'),
        start,
        el('button', { type: 'button', class: 'quiet', onclick: () => void load().catch(failed) }, 'Load'),
      ),
      report,
    ),
    ...ROLES.map(([role]) => editors[role].view),
  )
}
