import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadLessons } from '../lib/lessons.mjs'
import { copyLessonSolution, startLesson } from '../lib/start.mjs'

const LEARN = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lessons = loadLessons(LEARN)
const workshop = () => mkdtempSync(join(tmpdir(), 'mod-lab-start-'))
const manifestOf = dir => JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))

test('a lesson without a starter starts as its folder with a manifest naming its mod, and nothing else', () => {
  const lesson = lessons.find(one => one.starter === null)
  const dir = join(workshop(), lesson.mod)
  assert.equal(startLesson(lesson, dir), 'manifest')
  assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), ['.claude-plugin', join('.claude-plugin', 'plugin.json')])
  assert.equal(manifestOf(dir).name, lesson.mod)
})

test("a lesson with a starter starts as a copy of it, the manifest included", () => {
  const lesson = lessons.find(one => one.starter !== null)
  const dir = join(workshop(), lesson.mod)
  assert.equal(startLesson(lesson, dir), 'starter')
  assert.deepEqual(manifestOf(dir), manifestOf(lesson.starter))
  assert.equal(existsSync(join(dir, 'hooks', 'hooks.json')), true)
})

test('a folder that is there already is left as it is', () => {
  const lesson = lessons.find(one => one.starter !== null)
  const dir = join(workshop(), lesson.mod)
  mkdirSync(dir)
  assert.equal(startLesson(lesson, dir), null)
  assert.deepEqual(readdirSync(dir), [])
})

test('reference solutions retain authored source but omit plugin registration and generated engine files', () => {
  const root = workshop()
  const dir = join(root, 'lesson')
  const source = join(dir, 'solution')
  for (const [file, content] of Object.entries({
    'hooks/register.tsx': 'export const register = on => {}',
    'hooks/hooks.json': '{}',
    'types/index.d.ts': 'export interface Example {}',
    '.claude-plugin/plugin.json': '{"name":"reference"}',
    '.claude-plugin/types/index.d.ts': 'generated',
    'tsconfig.json': '{"generated":true}',
  })) {
    mkdirSync(resolve(source, file, '..'), { recursive: true })
    writeFileSync(join(source, file), content)
  }
  const destination = join(root, 'solutions', 'example')
  assert.equal(copyLessonSolution({ dir }, destination), true)
  assert.equal(readFileSync(join(destination, 'hooks', 'register.tsx'), 'utf8'), 'export const register = on => {}')
  assert.equal(readFileSync(join(destination, 'types', 'index.d.ts'), 'utf8'), 'export interface Example {}')
  assert.equal(existsSync(join(destination, 'hooks', 'hooks.json')), true)
  assert.equal(existsSync(join(destination, '.claude-plugin')), false)
  assert.equal(existsSync(join(destination, 'tsconfig.json')), false)
})

test('copying a reference again preserves existing edits and does not refill deleted files', () => {
  const lesson = lessons.find(one => one.id === 'tick')
  const destination = join(workshop(), 'solutions', lesson.id)
  mkdirSync(destination, { recursive: true })
  writeFileSync(join(destination, 'notes.md'), 'My comparison notes')
  assert.equal(copyLessonSolution(lesson, destination), false)
  assert.deepEqual(readdirSync(destination), ['notes.md'])
  assert.equal(readFileSync(join(destination, 'notes.md'), 'utf8'), 'My comparison notes')
})
