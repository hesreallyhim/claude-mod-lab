import type { LabTap } from '../types'
import { expect, mock, test } from 'claude-code/testing'

import { censusOf } from '../hooks/census'
import { interceptFor, LAPSE_MS, makeIntercept, setActive } from '../hooks/intercept'
import { lab, lastRun, read, reader, recordState, TEST } from './kit'

test("refuse: the probe's call is refused by the lab and nothing beneath runs", async ($, on) => {
  const reached: string[] = []
  on('fs.read', ($, e) => {
    reached.push(e.path)
    return { value: 'text' }
  })
  const recorded = recordState(on)

  await $.command.run(lab('intercept fs.read refuse'))
  await $.command.run(lab('fs.read notes-r1.md'))

  const run = lastRun(recorded)
  expect(run?.ok).toBe(false)
  expect(run?.dispatches[0]).toMatchObject({ event: 'fs.read', intercepted: 'refuse', chain: [] })
  expect(reached).toEqual([])
})

test('answer: the probe gets the value the lab answers with, and the engine is not asked', async ($, on) => {
  let asked = 0
  on('session.cwd', () => {
    asked += 1
    return { value: '/real' }
  })
  const recorded = recordState(on)

  await $.command.run(lab('intercept session.cwd answer "/pretend/a2"'))
  await $.command.run(lab('session.cwd'))

  expect(lastRun(recorded)?.value).toBe('/pretend/a2')
  expect(asked).toBe(0)
})

test('rewrite: the link beneath receives the changed e, and its chain entry shows it', async ($, on) => {
  const reached: string[] = []
  on('fs.read', ($, e) => {
    reached.push(e.path)
    return { value: 'other text' }
  })
  const recorded = recordState(on)

  await $.command.run(lab('intercept fs.read rewrite {"path": "/work/other-w3.md"}'))
  await $.command.run(lab('fs.read README.md'))

  expect(reached).toEqual(['/work/other-w3.md'])
  const link = lastRun(recorded)?.dispatches[0]?.chain[0]
  expect(link?.plugin).toBe(TEST)
  expect(link?.received).toMatchObject({ path: '/work/other-w3.md' })
})

test("watch others: another plugin's calls are kept as taps, and the lab's own are not", { plugins: [reader] }, async ($, on) => {
  on('fs.read', ($, e) => ({ value: `text of ${e.path}` }))
  const clock = mock.clock(on)
  const recorded = recordState(on)

  await $.command.run(lab('intercept fs.read watch others'))
  await $.command.run(read('/work/seen-q5.md'))
  await $.command.run(lab('fs.read /work/unseen-q6.md'))
  await clock.settle()

  const kept = recorded.taps.at(-1) ?? []
  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ origin: 'reader', event: 'fs.read', behavior: 'watch', received: { path: '/work/seen-q5.md' } })
  expect(kept[0]?.returned).toEqual({ value: 'text of /work/seen-q5.md' })
})

test("an intercept that changes other plugins' calls is in force until LAPSE_MS after it was set, and not a moment longer", () => {
  const since = 50_000
  const made = makeIntercept({ event: 'fs.stat', behavior: 'refuse', scope: 'others', value: '', ms: '0' }, since)
  if (!made.ok) throw new Error(made.error)
  setActive([made.value])

  expect(interceptFor('fs.stat', false, since + LAPSE_MS)).toBeDefined()
  expect(interceptFor('fs.stat', false, since + LAPSE_MS + 1)).toBeUndefined()
  setActive([])
})

test("a watch, and an intercept on the lab's own calls, never lapse", () => {
  const watching = makeIntercept({ event: 'fs.read', behavior: 'watch', scope: 'others', value: '', ms: '0' }, 0)
  const own = makeIntercept({ event: 'fs.stat', behavior: 'refuse', scope: 'lab', value: '', ms: '0' }, 0)

  expect(watching.ok && watching.value.until).toBeNull()
  expect(own.ok && own.value.until).toBeNull()
})

test('clear lifts an intercept, and the call reaches the engine again', async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  const recorded = recordState(on)

  await $.command.run(lab('intercept fs.exists refuse'))
  await $.command.run(lab('fs.exists README.md'))
  expect(lastRun(recorded)?.ok).toBe(false)

  await $.command.run(lab('intercept clear fs.exists'))
  await $.command.run(lab('fs.exists README.md'))

  expect(lastRun(recorded)).toMatchObject({ ok: true, value: true })
})

test('delay: the call waits the milliseconds asked, then goes on; the run lists the call and not the sleep', async ($, on) => {
  const clock = mock.clock(on)
  let isReached = false
  on('fs.exists', () => {
    isReached = true
    return { value: true }
  })
  const recorded = recordState(on)

  await $.command.run(lab('intercept fs.exists delay 700'))
  const running = $.command.run(lab('fs.exists README.md'))
  await clock.settle()
  await clock.advance(699)
  expect(isReached).toBe(false)
  await clock.advance(1)
  await running

  expect(isReached).toBe(true)
  const run = lastRun(recorded)
  expect(run?.dispatches.map(dispatch => dispatch.event)).toEqual(['fs.exists'])
  expect(run?.dispatches[0]?.intercepted).toBe('delay')
})

test('a malformed intercept is refused with the reason, and nothing is set', async ($, on) => {
  const recorded = recordState(on)

  const rewrite = await $.command.run(lab('intercept fs.read rewrite not-json'))
  const unknown = await $.command.run(lab('intercept prompt.compose watch'))

  expect(rewrite.text).toContain('rewrite takes a JSON object')
  expect(unknown.text).toContain('the lab does not hook prompt.compose')
  expect(recorded.intercepts).toEqual([])
})

function tap(fields: Partial<LabTap>): LabTap {
  return { seq: 1, at: 0, event: 'fs.read', origin: 'reader', behavior: 'watch', received: {}, returned: {}, chain: [], ms: 0, ...fields }
}

test('the census counts calls per event, who made them, who answered and each link; a call the lab answered is its own', () => {
  const link = (plugin: string, ms: number) => ({ plugin, tier: 'user', outcome: 'returned', ms })

  const [census] = censusOf([
    tap({ origin: 'reader', chain: [link('guard-c3', 1), link('engine', 4)] }),
    tap({ origin: 'reader', chain: [link('guard-c3', 3), link('engine', 6)] }),
    tap({ origin: 'other-c4', behavior: 'refuse', chain: [] }),
  ])

  expect(census).toMatchObject({
    event: 'fs.read',
    calls: 3,
    callers: [
      ['reader', 2],
      ['other-c4', 1],
    ],
    answeredBy: [
      ['engine', 2],
      ['mod-lab intercept (refuse)', 1],
    ],
  })
  expect(census?.links.map(one => [one.plugin, one.count, one.medianMs])).toEqual([
    ['guard-c3', 2, 2],
    ['engine', 2, 5],
  ])
})

test('/mod-lab intercept census adds up the calls a watch recorded', { plugins: [reader] }, async ($, on) => {
  on('fs.read', () => ({ value: 'text' }))
  const clock = mock.clock(on)
  recordState(on)
  const paths = ['/work/a-c1.md', '/work/b-c2.md', '/work/c-c3.md']

  await $.command.run(lab('intercept fs.read watch others'))
  for (const path of paths) await $.command.run(read(path))
  await clock.settle()
  const census = await $.command.run(lab('intercept census fs.read'))

  expect(census.text).toContain(`fs.read: ${paths.length} calls, made by reader ${paths.length}`)
})
