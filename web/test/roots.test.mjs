import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { initializeProjectLessons, PACKAGE_ROOT, STATE_DIR, workspaceRoot } from '../lib/roots.mjs'

// realpath: on macOS the temp folder is reached through a symlink.
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-roots-')))
const home = join(dir, 'home')
const mine = join(dir, 'mine')
mkdirSync(home)
mkdirSync(mine)
after(() => rmSync(dir, { recursive: true, force: true }))

test('the package root is the folder holding web/ and learn/', () => {
  assert.equal(existsSync(join(PACKAGE_ROOT, 'web', 'lib', 'roots.mjs')), true)
  assert.equal(existsSync(join(PACKAGE_ROOT, 'learn', 'check.mjs')), true)
})

test('the workspace is MOD_LAB_WORKSPACE, resolved from the working directory, else the working directory', () => {
  assert.equal(workspaceRoot({ env: {}, cwd: mine, home }), mine)
  assert.equal(workspaceRoot({ env: { MOD_LAB_WORKSPACE: mine }, cwd: dir, home }), mine)
  assert.equal(workspaceRoot({ env: { MOD_LAB_WORKSPACE: 'mine' }, cwd: dir, home }), mine)
  assert.equal(workspaceRoot({ env: { MOD_LAB_WORKSPACE: '' }, cwd: mine, home }), mine)
})

test('the home folder is refused, by either way of choosing it, and the message says how to choose another', () => {
  const refusal = /cannot be your home folder .*set MOD_LAB_WORKSPACE to one/
  assert.throws(() => workspaceRoot({ env: {}, cwd: home, home }), refusal)
  assert.throws(() => workspaceRoot({ env: { MOD_LAB_WORKSPACE: home }, cwd: mine, home }), refusal)
  assert.throws(() => workspaceRoot({ env: {}, cwd: `${home}/`, home }), refusal)
  const link = join(dir, 'home-link')
  symlinkSync(home, link)
  assert.throws(() => workspaceRoot({ env: {}, cwd: link, home }), refusal)
})

test('a MOD_LAB_WORKSPACE that is not a folder is refused rather than made', () => {
  assert.throws(
    () => workspaceRoot({ env: { MOD_LAB_WORKSPACE: join(dir, 'missing') }, cwd: mine, home }),
    /MOD_LAB_WORKSPACE names .*missing, which is not a folder/,
  )
})

test('in-session initialization preserves project files, lesson mods, and progress on repeated calls', () => {
  const project = mkdtempSync(join(dir, 'project-'))
  for (const name of ['README.md', '.gitignore', 'package.json']) writeFileSync(join(project, name), `original ${name}`)
  const link = join(dir, 'project-link')
  symlinkSync(project, link)

  assert.equal(initializeProjectLessons(link, { home }), project)
  assert.deepEqual(readdirSync(project).sort(), [
    '.claude-mod-lab',
    '.gitignore',
    'README.md',
    'package.json',
    'workshop',
  ])
  const progress = join(project, STATE_DIR, 'progress.json')
  const mod = join(project, 'workshop', 'my-mod.ts')
  writeFileSync(progress, '{"tick":"done"}')
  writeFileSync(mod, 'user code')

  assert.equal(initializeProjectLessons(project, { home }), project)
  for (const name of ['README.md', '.gitignore', 'package.json'])
    assert.equal(readFileSync(join(project, name), 'utf8'), `original ${name}`)
  assert.equal(readFileSync(progress, 'utf8'), '{"tick":"done"}')
  assert.equal(readFileSync(mod, 'utf8'), 'user code')
})

test('in-session initialization creates only lesson directories, without adding project documents', () => {
  const project = mkdtempSync(join(dir, 'no-documents-'))
  initializeProjectLessons(project, { home })
  assert.deepEqual(readdirSync(project).sort(), [STATE_DIR, 'workshop'])
})

test('in-session initialization refuses home, the package folder, files, and missing directories', () => {
  const homeLink = join(dir, 'init-home-link')
  const packageLink = join(dir, 'package-link')
  symlinkSync(home, homeLink)
  symlinkSync(PACKAGE_ROOT, packageLink)
  for (const folder of [home, homeLink])
    assert.throws(() => initializeProjectLessons(folder, { home }), /cannot be your home folder/)
  for (const folder of [PACKAGE_ROOT, packageLink])
    assert.throws(() => initializeProjectLessons(folder, { home }), /package folder is not a lesson workspace/)
  const file = join(dir, 'file')
  writeFileSync(file, 'unchanged')
  for (const folder of [file, join(dir, 'missing')])
    assert.throws(() => initializeProjectLessons(folder, { home }), /not an existing project folder/)
  assert.equal(readFileSync(file, 'utf8'), 'unchanged')
  assert.deepEqual(readdirSync(home), [])
  assert.equal(existsSync(join(dir, 'missing')), false)
})

test('reserved path collisions are rejected before either lesson directory is created', () => {
  for (const name of [STATE_DIR, 'workshop']) {
    for (const kind of ['file', 'link', 'dangling-link']) {
      const project = mkdtempSync(join(dir, 'collision-'))
      const target = join(project, name)
      if (kind === 'file') writeFileSync(target, 'unchanged')
      else symlinkSync(kind === 'link' ? mine : join(dir, 'absent-target'), target)
      assert.throws(() => initializeProjectLessons(project, { home }), /not a file or symbolic link/)
      assert.deepEqual(readdirSync(project), [name])
      if (kind === 'file') assert.equal(readFileSync(target, 'utf8'), 'unchanged')
    }
  }
  assert.deepEqual(readdirSync(mine), [])
  assert.equal(existsSync(join(dir, 'absent-target')), false)
})
