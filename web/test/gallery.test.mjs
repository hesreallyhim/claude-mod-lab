import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { excerptOf, modSnippet, readGallery, tabRows } from '../lib/gallery.mjs'

const GALLERY = fileURLToPath(new URL('../../mods/gallery-mod', import.meta.url))

test("every tab the page shows has its README row and its source, as the gallery's files stand", () => {
  const { tabs, problems } = readGallery(GALLERY)

  assert.deepEqual(problems, [])
  for (const tab of tabs) {
    assert.notEqual(tab.terminal, '', `${tab.id} has a terminal description`)
    assert.ok(tab.excerpts.every(excerpt => excerpt.text !== null))
  }
})

test('the gallery mod names every tab the page shows, and the page shows every tab', () => {
  const { tabs } = readGallery(GALLERY)
  const declared =
    /export type GalleryTab = ([^\n]+)/.exec(readFileSync(join(GALLERY, 'types', 'index.d.ts'), 'utf8'))?.[1] ?? ''

  assert.deepEqual(tabs.map(tab => tab.id).sort(), [...declared.matchAll(/'([a-z]+)'/g)].map(match => match[1]).sort())
})

test('every technique has a mod of its own in templates/, offered as a snippet', () => {
  const { tabs } = readGallery(GALLERY)

  for (const tab of tabs) {
    assert.equal(tab.template?.name, `${tab.id}-mod`)
    assert.ok(tab.template.description.length > 0, `${tab.template.name} has a description in its manifest`)
    assert.ok(tab.template.where, `templates/README.md says where ${tab.template.name} draws`)
    assert.ok(tab.template.snippet.includes(`cat > workshop/${tab.id}-mod/hooks/register.tsx <<'MOD'`))
  }
})

test('a snippet run by sh writes each file as it was, in the workshop', () => {
  const files = [
    { path: '.claude-plugin/plugin.json', text: '{ "name": "try-x" }\n' },
    { path: 'hooks/register.tsx', text: "const quoted = `${'$'}{x} and 'y' \\n`\nexport const register = () => {}" },
  ]
  const dir = mkdtempSync(join(tmpdir(), 'snippet-'))
  try {
    execFileSync('sh', ['-c', modSnippet('try-x', files)], { cwd: dir })
    for (const file of files) {
      const written = readFileSync(join(dir, 'workshop', 'try-x', file.path), 'utf8')
      assert.equal(written, file.text.endsWith('\n') ? file.text : `${file.text}\n`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a function is found with the comment above it, and a hook by its event and component', () => {
  const text = [
    "import { x } from './x'",
    '',
    '/** Doubles. */',
    'function double(n: number) {',
    '  return n * 2',
    '}',
    '',
    'export const register = on => {',
    '  // The band.',
    "  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => next(e))",
    "  on('ui.render', { component: 'Pane' }, async ($, e, next) => next(e))",
    '}',
  ].join('\n')

  assert.equal(
    excerptOf(text, 'a.ts', { name: 'double' }),
    '/** Doubles. */\nfunction double(n: number) {\n  return n * 2\n}',
  )
  assert.equal(
    excerptOf(text, 'a.ts', { hook: { event: 'ui.render', component: 'AbovePrompt' } }),
    "  // The band.\n  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => next(e))",
  )
  assert.equal(excerptOf(text, 'a.ts', { name: 'missing' }), null)
})

test("the README's tab table is read row by row, the first cell naming the tab", () => {
  const readme = [
    '# x',
    '',
    '| Tab | Terminal | Elsewhere |',
    '| --- | --- | --- |',
    '| Raster | cells | text |',
    '| Svg | bars | vector |',
    '',
    'After.',
  ].join('\n')

  assert.deepEqual(tabRows(readme), [
    { id: 'raster', title: 'Raster', terminal: 'cells', elsewhere: 'text' },
    { id: 'svg', title: 'Svg', terminal: 'bars', elsewhere: 'vector' },
  ])
})
