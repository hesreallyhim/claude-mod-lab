import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import type { LabJson, LabRun } from '../types'
import { formatEject } from '../hooks/eject'
import { PROBES } from '../hooks/probes'
import { formatClaimResults } from '../hooks/verify'
import { lab, lastRun, recordState } from './kit'

test('a probe answers with its value, the dispatch it made and its source', async ($, on) => {
  const cwd = '/injected/k4'
  on('session.cwd', () => ({ value: cwd }))
  const recorded = recordState(on)

  const out = await $.command.run(lab('session.cwd'))

  expect(out.text).toContain(JSON.stringify(cwd))
  expect(out.text).toContain('return $.session.cwd()')
  const run = lastRun(recorded)
  expect(run).toMatchObject({ probe: 'session.cwd', ok: true, value: cwd, from: 'command' })
  expect(run?.dispatches).toHaveLength(1)
  expect(run?.dispatches[0]).toMatchObject({ event: 'session.cwd', received: {}, returned: { value: cwd } })
  expect(run?.dispatches[0]?.chain.map(link => link.plugin)).toEqual(['test'])
})

// The kit has no session defaults for compose(); a real engine resolves these before hooks run.
const composeDefaults: Plugin = {
  name: 'compose-defaults',
  tier: 'prepend',
  register(on) {
    on('prompt.compose', ($, e, next) => next({
      ...e,
      promptModel: e.promptModel ?? 'test',
      surfaces: e.surfaces ?? [],
      tools: e.tools ?? [],
      outputStyle: e.outputStyle ?? null,
      traits: e.traits ?? [],
    }))
  },
}

test('prompt composition retains every section and its full text in the probe and dispatch', { plugins: [composeDefaults] }, async ($, on) => {
  const sections = Array.from({ length: 65 }, (_, index) => ({ id: `section-${index}`, scope: 'session' as const, text: `section ${index}\n${'x'.repeat(4100)}` }))
  on('prompt.compose', () => ({ sections }))
  const recorded = recordState(on)

  await $.command.run(lab('prompt.compose'))

  const run = lastRun(recorded)
  expect(run?.ok).toBe(true)
  expect(run?.value).toEqual(sections.map(section => ({ ...section, characters: section.text.length })))
  expect(run?.dispatches).toHaveLength(1)
  expect(run?.dispatches[0]?.event).toBe('prompt.compose')
  expect(run?.dispatches[0]).toMatchObject({ event: 'prompt.compose', returned: { sections } })
  expect(run?.dispatches[0]?.chain.map(link => link.plugin)).toEqual(['test'])

  // A composition outside a probe still runs normally, without creating log records.
  expect(await $.prompt.compose({ model: 'test', promptModel: 'test', surfaces: [], tools: [], outputStyle: null, traits: [] })).toEqual({ sections })
  expect(recorded.runs).toHaveLength(1)
  expect(recorded.taps).toEqual([])
  expect(recorded.traces).toEqual([])
})

test('named arguments reach the probe and each call shows in order', async ($, on) => {
  mock.store(on)
  const recorded = recordState(on)

  await $.command.run(lab('store.set {"key": "q9", "value": "[3, 1]"}'))

  const run = lastRun(recorded)
  expect(run?.value).toEqual({ key: 'q9', sent: [3, 1], readBack: [3, 1] })
  expect(run?.dispatches.map(dispatch => dispatch.event)).toEqual(['store.set', 'store.get'])
  expect(run?.dispatches[0]?.received).toEqual({ key: 'q9', value: [3, 1] })
})

test('a plain-data read of $ dispatches nothing', async ($, on) => {
  const recorded = recordState(on)

  await $.command.run(lab('plugin.info'))

  const run = lastRun(recorded)
  expect(run?.value).toMatchObject({ name: 'mod-lab' })
  expect(run?.dispatches).toEqual([])
})

test('a refused call is recorded with the refusal and the input hooks saw', async ($, on) => {
  on('fs.read', () => ({ deny: 'not here' }))
  const recorded = recordState(on)

  const out = await $.command.run(lab('fs.read some/where.md'))

  const run = lastRun(recorded)
  expect(run?.ok).toBe(false)
  expect(run?.error).toContain('not here')
  expect(out.text).toContain('failed')
  // Hooks see the path resolved against the working directory and the default `as` filled in.
  const received = run?.dispatches[0]?.received as { path: string; as: string }
  expect(received.path).toEndWith('/some/where.md')
  expect(received.path).not.toBe('some/where.md')
  expect(received.as).toBe('text')
})

test('the list counts every probe and an unknown id is named back', async $ => {
  const list = await $.command.run(lab('list'))
  expect(list.text).toContain(`${PROBES.length} probes`)

  const unknown = await $.command.run(lab('nothing.here'))
  expect(unknown.text).toContain('No probe is named nothing.here')
})

test('every probe in the catalog is reachable by its id', async ($, on) => {
  const recorded = recordState(on)

  for (const probe of PROBES) {
    await $.command.run(lab(probe.id))
  }

  const runs = recorded.runs.at(-1) ?? []
  expect(runs.map(run => run.probe)).toEqual(PROBES.map(probe => probe.id))
  const unreachable = runs.filter(run => run.error?.includes('no probe is named'))
  expect(unreachable).toEqual([])
})

test('eject answers each event with the session\'s values, a repeated event in order, a rejected call as a refusal', () => {
  const dispatch = (event: string, received: LabJson, returned: LabJson) => ({ event, received, returned, chain: [] })
  const run: LabRun = {
    seq: 7,
    probe: 'made-up',
    args: {},
    from: 'command',
    ok: true,
    value: null,
    error: null,
    ms: 1,
    at: 0,
    dispatches: [
      dispatch('store.get', { key: 'first-e1' }, { value: 'one-e2' }),
      dispatch('fs.read', { path: '/missing-e3' }, { rejected: 'ENOENT-e4' }),
      dispatch('store.get', { key: 'second-e5' }, { value: 'two-e6' }),
      dispatch('store.set', { key: 'k' }, {}),
    ],
  }

  const text = formatEject(run)

  expect(text).toContain('const storeGetAnswers = [{"value":"one-e2"}, {"value":"two-e6"}]')
  expect(text).toContain('{ deny: "ENOENT-e4" }')
  expect(text).toContain("on('store.set', () => ({ value: undefined }))")
})

test('/mod-lab eject copies the text it answers with', async ($, on) => {
  recordState(on)
  const copied: string[] = []
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })

  await $.command.run(lab('state.stale'))
  const ejected = await $.command.run(lab('eject'))

  expect(copied).toHaveLength(1)
  expect(ejected.text?.startsWith(copied[0] ?? '-')).toBe(true)
})

test('/mod-lab eject names a run it does not keep', async ($, on) => {
  recordState(on)

  expect((await $.command.run(lab('eject 999'))).text).toContain('999')
})

test('verify checks what the lab relies on about the engine here and says how many claims hold', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  recordState(on)
  on('session.cwd', () => ({ value: '/work/v1' }))
  on('session.root', () => ({ value: '/work/v1' }))
  on('session.id', () => ({ value: 'session-v2' }))
  on('session.version', () => ({ value: { version: '9.9.9-v3', base: '9.9.9', builtAt: '' } }) as never)
  on('fs.read', () => ({ value: 'readme text' }))

  let isDone = false
  const verifying = $.command.run(lab('verify')).finally(() => (isDone = true))
  for (let tick = 0; tick < 50 && !isDone; tick += 1) await clock.advance(10)
  const report = (await verifying).text ?? ''

  // The kit stands in for a session, so which claims hold here is not the point: that each is checked and counted is.
  const [, held, checked] = /: (\d+) of (\d+) claims/.exec(report) ?? []
  expect(report).toContain('Claude Code 9.9.9-v3')
  expect(Number(checked)).toBeGreaterThan(0)
  expect(Number(held)).toBeLessThanOrEqual(Number(checked))
  expect(report.split('\n').filter(line => /^[✓✗] /.test(line))).toHaveLength(Number(checked))
})

// A probe's value keeps 60 items, so the claim must read the whole list to find a tool listed after them.
test("verify finds the lab's probe tool listed after more than 60 others", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  recordState(on)
  on('session.cwd', () => ({ value: '/work/t1' }))
  on('session.version', () => ({ value: { version: '9.9.9-t2', base: '9.9.9', builtAt: '' } }) as never)
  const others = Array.from({ length: 70 }, (_, i) => ({ name: `mcp__many__tool_${i}`, description: '' }))
  on('tool.list', () => ({ value: [...others, { name: 'mcp__mod-lab__probe', description: '' }] }) as never)

  let isDone = false
  const verifying = $.command.run(lab('verify')).finally(() => (isDone = true))
  for (let tick = 0; tick < 50 && !isDone; tick += 1) await clock.advance(10)
  const report = (await verifying).text ?? ''

  expect(report).toContain("✓ $.tool.register names the lab's probe tool mcp__mod-lab__probe")
})

// The kit resolves a relative path against the folder of the plugin under test, as a session does against its directory, so session.cwd answers the lab's root.
test("verify's normalization claim holds where the read fails, since hooks see e before the read", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const recorded = recordState(on)
  let root = ''
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: 'session-n2' }))
  on('session.version', () => ({ value: { version: '9.9.9-n3', base: '9.9.9', builtAt: '' } }) as never)
  on('fs.read', () => ({ deny: 'ENOENT n4' }))
  await $.command.run(lab('plugin.info'))
  const info = lastRun(recorded)?.value
  root = info !== null && typeof info === 'object' && !Array.isArray(info) ? String(info.root) : ''

  let isDone = false
  const verifying = $.command.run(lab('verify')).finally(() => (isDone = true))
  for (let tick = 0; tick < 50 && !isDone; tick += 1) await clock.advance(10)
  const report = (await verifying).text ?? ''

  expect(report).toContain("✓ hooks see $.fs.read('README.md') with the path resolved against the session's directory and as: 'text'")
})

/** mod-lab-target as far as /mod-lab verify uses it: hooks that fail as each path asks, and a timer the plugin's own hook may see. */
const target: Plugin = {
  name: 'mod-lab-target',
  register(on) {
    let isTimerCallSeen = false
    on('fs.exists', { path: '/dev/null/mod-lab-target/skipped' }, () => {
      throw new Error('skipped-s1')
    })
    on('fs.exists', { path: '/dev/null/mod-lab-target/caught' }, () => {
      throw new Error('caught-c1')
    }).catch(() => ({ value: true }))
    on('fs.exists', { path: '/dev/null/mod-lab-target/kept' }, async ($, e, next) => {
      await next(e)
      throw new Error('kept-k1')
    })
    on('fs.exists', { path: '/dev/null/mod-lab-target/arm-timer' }, ($, e, next) => {
      $.clock.after(10, () => void $.fs.exists('/dev/null/mod-lab-target/from-timer'))
      return next(e)
    })
    on('fs.exists', { path: '/dev/null/mod-lab-target/from-timer' }, ($, e, next) => {
      isTimerCallSeen = true
      return next(e)
    })
    on('fs.read', { path: '/dev/null/mod-lab-target/report' }, () => ({ value: JSON.stringify({ isTimerCallSeen }) }))
  },
}

test('with mod-lab-target beneath the lab, verify reads each failed hook\'s outcome off its chain', { plugins: [target] }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/work/v1' }))
  on('session.root', () => ({ value: '/work/v1' }))
  on('session.id', () => ({ value: 'session-v2' }))
  on('session.version', () => ({ value: { version: '9.9.9-v3', base: '9.9.9', builtAt: '' } }) as never)
  on('fs.read', () => ({ value: 'readme text' }))
  on('fs.exists', () => ({ value: false }))

  let isDone = false
  const verifying = $.command.run(lab('verify')).finally(() => (isDone = true))
  for (let tick = 0; tick < 50 && !isDone; tick += 1) await clock.advance(10)
  const report = (await verifying).text ?? ''

  for (const outcome of ['skipped', 'caught', 'kept']) expect(report).toMatch(new RegExp(`✓ a hook that throws [^\\n]*is ${outcome}`))
  expect(report).toContain("✓ a call from a timer that fires after the hook that set it returned skips the plugin's own hooks")
})

test('a claim that could not be checked is marked, said why, and left out of the count', () => {
  const text = formatClaimResults(
    [
      { claim: 'a claim that holds', section: 'one', holds: true, detail: 'fine' },
      { claim: 'a claim left unchecked', section: 'two', holds: null, detail: 'not checked: no companion u1' },
    ],
    '1.2.3',
  )

  expect(text).toContain('1.2.3')
  expect(text).toMatch(/\b1 of 1 claims\b[^\n]*\b1 not checked/)
  expect(text).toMatch(/· a claim left unchecked \(two\)\n +not checked: no companion u1/)
})

test('the results name each claim and say why one does not hold', () => {
  const text = formatClaimResults(
    [
      { claim: 'a claim that holds', section: 'one', holds: true, detail: 'fine' },
      { claim: 'a claim that does not', section: 'two', holds: false, detail: 'saw something else v4' },
    ],
    '1.2.3',
  )

  expect(text).toContain('1.2.3: 1 of 2 claims')
  expect(text).toMatch(/✗ a claim that does not \(two\)\n +saw something else v4/)
  expect(text).not.toContain('fine')
})
