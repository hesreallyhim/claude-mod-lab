import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { isGeneratedDeclaration } from '../distribution-policy.mjs'

test('npm excludes generated declaration trees but retains authored plugin contracts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mod-lab-distribution-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { files } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'distribution-fixture', version: '0.0.0', files }))
  const generated = [
    'mods/example/.claude-plugin/types/claude-code/index.d.ts',
    'mods/example/.claude-plugin/types/claude-code/testing.d.ts',
    'templates/example/.claude-plugin/types/claude-code-tools/index.d.ts',
    'learn/tutorials/example/starter/.claude-plugin/types/claude-code-mcp/index.d.ts',
    'plugins/mod-bootstrap/.claude-plugin/types/another-plugin/index.d.ts',
    'mods/example/copied/claude-code/index.d.ts',
    'web/copied/claude-code-tools/index.d.ts',
    'learn/copied/claude-code-mcp/index.d.ts',
  ]
  const contract = 'mods/example/types/index.d.ts'
  for (const path of [...generated, contract]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), 'export interface FixtureState { count: number }\n')
  }
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json'], {
    cwd: dir, encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  const [packed] = JSON.parse(result.stdout)
  const paths = packed.files.map(file => file.path)
  for (const path of generated) assert.ok(!paths.includes(path), `must exclude ${path}`)
  assert.ok(paths.includes(contract), 'must retain the authored plugin contract')
})

test('the release guard detects relocated generated declarations without rejecting module augmentations', () => {
  assert.equal(isGeneratedDeclaration('mods/x/.claude-plugin/types/other-plugin/index.d.ts'), true)
  assert.equal(isGeneratedDeclaration('web/copied/claude-code/testing.d.ts'), true)
  assert.equal(isGeneratedDeclaration('learn/copied/claude-code-tools/index.d.ts'), true)
  assert.equal(isGeneratedDeclaration('templates/copied/claude-code-mcp/index.d.ts'), true)
  assert.equal(isGeneratedDeclaration('mods/x/types/renamed.d.ts', '// Written by Claude Code 0.0.0.\n'), true)
  assert.equal(isGeneratedDeclaration('mods/x/types/index.d.ts', "declare module 'claude-code' { interface Fixture {} }"), false)
})
