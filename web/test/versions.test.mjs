import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareVersions, engineText, isNotRun, needsNewer, sessionVersion, updateText } from '../public/versions.js'

const COMPAT = {
  floor: '2.1.299',
  testedThrough: '2.1.303',
  plugins: {},
  capabilities: { 'future.thing': { since: '2.1.310', uses: ['future.thing'] } },
}

test('versions compare by release, a build suffix left out', () => {
  assert.ok(compareVersions('2.1.299', '2.1.300') < 0)
  assert.ok(compareVersions('2.1.1000', '2.1.999') > 0)
  assert.equal(compareVersions('2.1.304-dev.20261020', '2.1.304'), 0)
})

test("the session's build is the hello's engine, else the session facts' version, with its surfaces in words", () => {
  const session = {
    facts: { version: '2.1.303' },
    engine: { version: '2.1.303', surfaces: ['terminal', 'desktop', 'mobile'] },
  }
  assert.equal(engineText(session), 'Claude Code 2.1.303')
  assert.equal(engineText({ facts: { version: '2.1.302' }, engine: null }), 'Claude Code 2.1.302')
  assert.equal(engineText({ facts: {}, engine: null }), null)
  assert.equal(sessionVersion(null), null)
})

test('only a version below the floor gets a notice, and it names no version', () => {
  assert.equal(updateText('2.1.292', COMPAT), 'Update Claude Code to use mod-lab.')
  assert.equal(updateText('2.1.299', COMPAT), null)
  // Past the version tested through is a record for maintainers, not a notice.
  assert.equal(updateText('2.1.310', COMPAT), null)
})

test('a template or lesson needs a newer version only when the session is known to run an older one', () => {
  assert.equal(needsNewer('2.1.300', '2.1.299'), true)
  assert.equal(needsNewer('2.1.300', '2.1.300'), false)
  assert.equal(needsNewer('2.1.300', null), false)
  assert.equal(needsNewer(null, '2.1.299'), false)
})

test('a run the capability table kept from running reads as not run, not failed', () => {
  assert.equal(isNotRun({ ok: false, error: 'needs a newer version of Claude Code' }), true)
  assert.equal(isNotRun({ ok: false, error: 'TypeError: boom' }), false)
  assert.equal(isNotRun({ ok: true, error: null }), false)
})
