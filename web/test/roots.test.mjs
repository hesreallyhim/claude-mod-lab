import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PACKAGE_ROOT, workspaceRoot } from '../lib/roots.mjs'

// realpath: on macOS the temp folder is reached through a symlink.
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-roots-')))
const home = join(dir, 'home')
const mine = join(dir, 'mine')
mkdirSync(home)
mkdirSync(mine)

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
