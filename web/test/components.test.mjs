import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createComponents, HOW_TO_TRY } from '../lib/components.mjs'
import { exampleNames } from '../lib/sandbox.mjs'

const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url))
const GALLERY = join(EXAMPLES, '..', 'mods', 'gallery-mod')

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'components-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('every example, and the gallery mod, is a component with a line saying how to try it', () => {
  const components = createComponents({
    examplesDir: EXAMPLES,
    skillsDir: '/nowhere',
    others: { 'gallery-mod': GALLERY },
  })
  assert.deepEqual(
    components.list().map(one => one.name),
    [...exampleNames(EXAMPLES), 'gallery-mod'],
  )
  for (const one of components.list()) {
    assert.ok(HOW_TO_TRY[one.name], `${one.name} has no line in HOW_TO_TRY`)
    assert.ok(one.description.length > 0, `${one.name} has no description in its manifest`)
  }
})

test('add copies the example without the files the engine writes, and remove deletes the copy', () =>
  inTemp(dir => {
    const examplesDir = join(dir, 'examples')
    const mod = join(examplesDir, 'brackets-mod')
    mkdirSync(join(mod, '.claude-plugin', 'types'), { recursive: true })
    mkdirSync(join(mod, 'hooks'))
    writeFileSync(
      join(mod, '.claude-plugin', 'plugin.json'),
      '{ "name": "brackets-mod", "description": "closes brackets" }',
    )
    writeFileSync(join(mod, '.claude-plugin', 'types', 'index.d.ts'), 'engine')
    writeFileSync(join(mod, 'tsconfig.json'), '{}')
    writeFileSync(join(mod, 'hooks', 'register.tsx'), 'export const register = () => {}\n')
    const components = createComponents({ examplesDir, skillsDir: join(dir, '.claude', 'skills') })

    const added = components.add('brackets-mod')
    const copy = join(dir, '.claude', 'skills', 'brackets-mod')
    assert.deepEqual([added.isAdded, added.isEdited], [true, false])
    assert.equal(readFileSync(join(copy, 'hooks', 'register.tsx'), 'utf8'), 'export const register = () => {}\n')
    assert.equal(existsSync(join(copy, 'tsconfig.json')), false)
    assert.equal(existsSync(join(copy, '.claude-plugin', 'types')), false)
    assert.throws(() => components.add('brackets-mod'), /already there/)

    // The engine's own files beside the copy are not changes of the person's.
    writeFileSync(join(copy, 'tsconfig.json'), '{ "extends": "x" }')
    assert.equal(components.view('brackets-mod').isEdited, false)

    assert.equal(components.remove('brackets-mod').isAdded, false)
    assert.equal(existsSync(copy), false)
  }))

test('a copy with changes goes only when forced, and a folder that is not the component is left alone', () =>
  inTemp(dir => {
    const examplesDir = join(dir, 'examples')
    mkdirSync(join(examplesDir, 'keycast-mod', '.claude-plugin'), { recursive: true })
    writeFileSync(join(examplesDir, 'keycast-mod', '.claude-plugin', 'plugin.json'), '{ "name": "keycast-mod" }')
    mkdirSync(join(examplesDir, 'brackets-mod', '.claude-plugin'), { recursive: true })
    writeFileSync(join(examplesDir, 'brackets-mod', '.claude-plugin', 'plugin.json'), '{ "name": "brackets-mod" }')
    const skillsDir = join(dir, 'skills')
    const components = createComponents({ examplesDir, skillsDir })

    components.add('keycast-mod')
    writeFileSync(join(skillsDir, 'keycast-mod', 'notes.md'), 'mine')
    assert.deepEqual(
      [components.view('keycast-mod').isEdited, components.remove('keycast-mod').isRefused],
      [true, true],
    )
    assert.equal(existsSync(join(skillsDir, 'keycast-mod', 'notes.md')), true)
    assert.equal(components.remove('keycast-mod', { force: true }).isAdded, false)

    mkdirSync(join(skillsDir, 'brackets-mod'))
    assert.deepEqual(
      [components.view('brackets-mod').isForeign, components.view('brackets-mod').isAdded],
      [true, false],
    )
    assert.throws(() => components.remove('brackets-mod', { force: true }), /left alone/)
    assert.throws(() => components.add('../examples'), /no component/)
  }))
