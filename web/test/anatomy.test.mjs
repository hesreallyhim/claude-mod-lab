import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readAnatomy } from '../lib/anatomy.mjs'

function plugin(root, name, isMod) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '1.2.3' }))
  if (isMod) writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.ts'] }))
  return dir
}

test("installed plugins, the package's mods and the workspace's workshop are read; only those with a hooks module are validated", async () => {
  const repo = mkdtempSync(join(tmpdir(), 'anatomy-'))
  const workspace = mkdtempSync(join(tmpdir(), 'anatomy-workspace-'))
  const installed = plugin(join(repo, 'cache'), 'gauge-a1', true)
  plugin(join(repo, 'cache'), 'skills-a2', false)
  plugin(join(repo, 'mods'), 'lab-a4', true)
  plugin(join(workspace, 'workshop'), 'mine-a3', true)
  const validated = []
  const list = async () =>
    JSON.stringify([
      { id: 'gauge-a1@market', version: '1.0.0', enabled: true, installPath: installed },
      { id: 'skills-a2@market', version: '1.0.0', enabled: false, installPath: join(repo, 'cache', 'skills-a2') },
    ])
  const validate = async path => {
    validated.push(path)
    return JSON.stringify({
      success: true,
      manifest: { notes: [] },
      contents: [{ notes: ['./register.ts hooks: tool.call'], gatingHooks: [] }],
    })
  }

  const mods = await readAnatomy(join(repo, 'mods'), join(workspace, 'workshop'), { list, validate })

  assert.deepEqual(
    mods.map(mod => [mod.id, mod.source, mod.isMod]),
    [
      ['gauge-a1@market', 'installed', true],
      ['skills-a2@market', 'installed', false],
      ['lab-a4', 'repo', true],
      ['mine-a3', 'workshop', true],
    ],
  )
  assert.deepEqual(validated, [installed, join(repo, 'mods', 'lab-a4'), join(workspace, 'workshop', 'mine-a3')])
  assert.deepEqual(mods[0].validation.facts.hooks, ['tool.call'])
})
