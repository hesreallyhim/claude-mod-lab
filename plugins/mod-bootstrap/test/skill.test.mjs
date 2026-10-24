// The mod-bootstrap skill's templates, read out of SKILL.md and written as
// the skill would write them: the mod must validate, type-check and pass its
// test on this build. Run by npm run test:plugins, part of npm run check.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const SKILL = readFileSync(fileURLToPath(new URL('../skills/mod-bootstrap/SKILL.md', import.meta.url)), 'utf8')

/** Each `### <path>` heading of SKILL.md with the fenced block under it; the README's block is fenced with four backticks. */
function templates(text) {
  return Object.fromEntries([...text.matchAll(/^### (\S+)\n\n(`{3,})\w*\n([\s\S]*?)\n\2$/gm)].map(([, path, , body]) => [path, `${body}\n`]))
}

test('SKILL.md holds the six files under their paths', () => {
  assert.deepEqual(Object.keys(templates(SKILL)), ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.ts', 'types/index.d.ts', 'tests/<name>.test.ts', 'README.md'])
  assert.ok(templates(SKILL)['README.md'].includes('claude --plugin-dir .'), "the README's own code block stays inside it")
})

test('a mod written from the templates validates, type-checks and passes its test', { timeout: 240_000 }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'mod-bootstrap-')), 'new-mod')
  const fill = text => text.replaceAll('<name>', 'new-mod').replaceAll('<description>', 'Counts tool calls').replaceAll('<author>', 'Someone')
  for (const [path, body] of Object.entries(templates(SKILL))) {
    mkdirSync(dirname(join(dir, fill(path))), { recursive: true })
    writeFileSync(join(dir, fill(path)), fill(body))
  }
  const run = (file, args) => spawnSync(file, args, { cwd: REPO, encoding: 'utf8' })

  const validated = run('claude', ['plugin', 'validate', '--json', dir])
  assert.equal(JSON.parse(validated.stdout).success, true, `it validates: ${validated.stdout}`)
  const typed = run(process.execPath, [join(REPO, 'scripts', 'typecheck.mjs'), dir])
  assert.equal(typed.status, 0, `it type-checks: ${typed.stdout}${typed.stderr}`)
  const tested = run('claude', ['plugin', 'test', dir])
  assert.equal(tested.status, 0, `it passes its test: ${tested.stdout}${tested.stderr}`)
})
