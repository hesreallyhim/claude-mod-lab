import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { claudeVersion, findTypes, missingTypes, skillCopy } from '../lib/types-path.mjs'

const dir = mkdtempSync(join(tmpdir(), 'mod-lab-types-'))

/** Writes a declaration file at `path`, its header naming `version`, and answers the path. */
function declarations(path, version) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `// Written by Claude Code ${version}.\n`)
  return path
}

const laid = root => join(root, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
const copyAt = (bases, version, build) =>
  join(bases, 'bundled-skills', version, build, 'plugin-authoring', 'types', 'claude-code.d.ts')

// Each place in the lookup's order holds a file, so each step is seen to win over the ones after it.
const explicit = declarations(join(dir, 'explicit', 'claude-code.d.ts'), '1.0.1')
const lab = join(dir, 'plugins', 'mod-lab')
const bridge = join(dir, 'plugins', 'mod-lab-bridge')
declarations(laid(lab), '1.0.2')
declarations(laid(bridge), '1.0.3')
const workspace = join(dir, 'workspace')
declarations(laid(join(workspace, '.claude', 'skills', 'b-skill')), '1.0.4')
declarations(laid(join(workspace, '.claude', 'skills', 'a-skill')), '1.0.4')
const bases = join(dir, 'tmp')
declarations(copyAt(bases, '1.0.5', 'build-a'), '1.0.5')
const never = () => {
  throw new Error('the version was asked for, though a step before the skill copy had a file')
}

test("the lookup's order: MOD_LAB_TYPES, the session's plugins, the workspace's skills, the skill's copy", () => {
  const options = { roots: [lab, bridge], workspace, version: '1.0.5', bases: [bases], askVersion: never }
  assert.deepEqual(findTypes({ explicit, ...options }), {
    path: explicit,
    found: 'MOD_LAB_TYPES',
    version: null,
    looked: [explicit, laid(lab), laid(bridge), laid(join(workspace, '.claude', 'skills', '*'))],
  })
  assert.equal(findTypes(options).found, `beside ${lab}`)
  assert.equal(findTypes({ ...options, roots: [bridge] }).found, `beside ${bridge}`)
  assert.deepEqual(findTypes({ ...options, roots: [] }).found, 'in .claude/skills/a-skill')
  const copy = findTypes({ ...options, roots: [], workspace: join(dir, 'elsewhere') })
  assert.deepEqual(
    [copy.path, copy.found, copy.version],
    [copyAt(bases, '1.0.5', 'build-a'), "the plugin-authoring skill's copy for 1.0.5", '1.0.5'],
  )
})

test("a MOD_LAB_TYPES that names no file is passed over, as is a plugin's folder with nothing laid in it", () => {
  const found = findTypes({ explicit: join(dir, 'missing.d.ts'), roots: [join(dir, 'bare'), lab], askVersion: never })
  assert.equal(found.path, laid(lab))
})

test("the skill's copy is the one for the session's version, not the newest; the newest build where a version has several", () => {
  declarations(copyAt(bases, '1.0.6', 'build-a'), '1.0.6')
  const older = declarations(copyAt(bases, '1.0.5', 'build-b'), '1.0.5')
  const newer = copyAt(bases, '1.0.5', 'build-a')
  utimesSync(older, new Date(1_000_000), new Date(1_000_000))
  assert.equal(skillCopy('1.0.5', [bases]), newer)
  // 1.0.6's copy is the newest by date; the lookup still takes the copy for the session's version.
  assert.equal(findTypes({ version: '1.0.5', bases: [bases], askVersion: never }).path, newer)
  assert.equal(skillCopy('1.0.6', [bases]), copyAt(bases, '1.0.6', 'build-a'))
  assert.equal(skillCopy('1.0.7', [bases, join(dir, 'no-such-base')]), null)
})

test("without the session's version the skill's copy is looked for at the version claude answers", () => {
  const asked = []
  const found = findTypes({ bases: [bases], askVersion: () => (asked.push('asked'), '1.0.6') })
  assert.deepEqual([found.path, found.version, asked], [copyAt(bases, '1.0.6', 'build-a'), '1.0.6', ['asked']])
  const none = findTypes({ bases: [bases], askVersion: () => null })
  assert.deepEqual([none.path, none.version], [null, null])
})

test('finding nothing says for which version, and how to get the declarations', () => {
  const found = findTypes({ workspace: join(dir, 'elsewhere'), version: '1.0.9', bases: [bases] })
  assert.deepEqual([found.path, found.version], [null, '1.0.9'])
  assert.match(found.looked.at(-1), /plugin-authoring skill's copy for 1\.0\.9/)
  const message = missingTypes(found)
  assert.match(message, /^No engine declarations found for Claude Code 1\.0\.9, so there is no reference/)
  assert.match(message, /never into an installed copy/)
  assert.match(message, /npx claude-mod-lab@alpha\b.*\/plugin-authoring.*MOD_LAB_TYPES/)
  assert.match(missingTypes({ version: null }), /^No engine declarations found, so/)
})

test('the version claude answers is its number alone, or null without a claude to ask', () => {
  const version = claudeVersion()
  assert.ok(version === null || /^\d+\.\d+\.\d+/.test(version), String(version))
})
