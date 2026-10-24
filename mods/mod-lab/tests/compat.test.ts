import { expect, mock, test } from 'claude-code/testing'

import { compareVersions, parseCompat } from '../hooks/compat'
import type { Build } from './kit'
import { compatText, lab, labStart, lastRun, recordState } from './kit'

const RANGE = compatText({ floor: '3.0.10', testedThrough: '3.0.30' })

test('a version below the floor is told to update once per version, remembered in the store; one at or above it is not told', async ($, on) => {
  mock.store(on)
  const build: Build = { version: '3.0.40', compat: RANGE }
  const started = labStart($, on, build)

  await started.start()
  await started.start()
  build.version = '3.0.5'
  await started.start()
  build.version = '3.0.20'
  await started.start()

  // 3.0.40 is past the version tested through, which is a record for maintainers and says nothing.
  expect(started.logged).toHaveLength(1)
  expect(started.logged[0]).toContain('update Claude Code')
  expect(started.logged[0]).not.toMatch(/\d+\.\d+\.\d+/)
})

test('a step of session.start that fails is logged, and the steps after it run', async ($, on) => {
  mock.store(on)
  const started = labStart($, on, { version: '3.0.5', compat: RANGE, refuse: 'tool.register' })

  await started.start()

  expect(started.logged).toHaveLength(2)
  expect(started.logged[0]).toContain('refused-r1')
  // The version check, a later step, still ran.
  expect(started.logged[1]).toContain('update Claude Code')
})

test('/mod-lab says the surfaces the session draws on, with no version number', async ($, on) => {
  // A surface this build has no name for, so the line shows it as given.
  on('session.surfaces', () => ({ value: ['surface-z9' as never] }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'room-w1' } }))
  await labStart($, on, { version: '3.0.20', compat: RANGE }).start()

  const out = await $.command.run(lab(''))

  expect(out.text).toContain('mod-lab is running in surface-z9.')
  expect(out.text).not.toContain('3.0.')
})

test('a feature newer than the engine is left out of the list, and asked for by name says it needs a newer Claude Code without running', async ($, on) => {
  let asked = 0
  on('session.cwd', () => {
    asked += 1
    return { value: '/work/c1' }
  })
  const recorded = recordState(on)
  const capabilities = { 'session.cwd': { since: '3.0.25', uses: ['session.cwd'] }, compact: { since: '3.0.26', uses: ['session.compact'] } }
  await labStart($, on, { version: '3.0.20', compat: compatText({ floor: '3.0.10', testedThrough: '3.0.30', capabilities }) }).start()

  const list = await $.command.run(lab('list'))
  const probe = await $.command.run(lab('session.cwd'))
  const command = await $.command.run(lab('compact'))

  expect(list.text).not.toMatch(/^session: .*\bcwd\b/m)
  expect(list.text).toMatch(/^session: /m)
  // Neither ran, and each says so in words, with no version number.
  expect(asked).toBe(0)
  expect(lastRun(recorded)).toMatchObject({ probe: 'session.cwd', ok: false, error: 'needs a newer version of Claude Code', dispatches: [] })
  expect(probe.text).toContain('needs a newer version of Claude Code')
  expect(command.text).toBe('/mod-lab compact needs a newer version of Claude Code.')
})

test('versions compare by release, and a malformed compat.json or entry is left out', () => {
  expect(compareVersions('2.1.299', '2.1.300')).toBeLessThan(0)
  expect(compareVersions('2.1.1000', '2.1.999')).toBeGreaterThan(0)
  expect(compareVersions('2.1.304-dev.20261020.t101500.sha1a2b3c4', '2.1.304')).toBe(0)
  expect(parseCompat('{"floor": "3.0.10"}')).toBe(null)
  expect(parseCompat('not json')).toBe(null)
  const parsed = parseCompat(compatText({ floor: '3.0.10', testedThrough: '3.0.30', capabilities: { kept: { since: '3.0.20', uses: ['x.y'] }, dropped: { since: 'soon' } } }))
  expect(parsed?.capabilities).toEqual({ kept: { since: '3.0.20', uses: ['x.y'] } })
})
