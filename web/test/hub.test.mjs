import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { BRIDGE_PROTOCOL, compatOf, createHub, protocolMessage } from '../lib/hub.mjs'

function clockAt(start = 1_000) {
  const clock = { now: start }
  return { clock, now: () => clock.now }
}

const PROBES = [{ id: 'fs.read' }, { id: 'clock.now' }]

test('a job queued from the page reaches the session and its run comes back', () => {
  const { now } = clockAt()
  const hub = createHub({ now })
  const events = []
  hub.subscribe((type, data) => events.push([type, data]))

  assert.match(hub.enqueue('fs.read', {}).error, /no session is connected/)

  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })
  const { job } = hub.enqueue('fs.read', { path: 'x.md' })
  assert.deepEqual(hub.next(client), { id: job, probe: 'fs.read', args: { path: 'x.md' } })
  assert.equal(hub.next(client), null)

  const run = { seq: 4, probe: 'fs.read', ok: true }
  assert.equal(hub.addRuns(client, [run], job), true)
  const snapshot = hub.snapshot()
  assert.deepEqual(snapshot.runs, [run])
  assert.equal(snapshot.jobs[0].status, 'done')
  assert.deepEqual(
    events.map(([type]) => type),
    ['session', 'job', 'job', 'run', 'job'],
  )
})

test('runs and trace rows are kept once each, by their sequence number', () => {
  const hub = createHub()
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })
  hub.addRuns(client, [{ seq: 1 }, { seq: 2 }], null)
  hub.addRuns(client, [{ seq: 2 }, { seq: 3 }], null)
  hub.addTraces(client, [{ seq: 1 }])
  hub.addTraces(client, [{ seq: 1 }, { seq: 2 }])
  assert.deepEqual(
    hub.snapshot().runs.map(run => run.seq),
    [1, 2, 3],
  )
  assert.deepEqual(
    hub.snapshot().traces.map(row => row.seq),
    [1, 2],
  )
})

test('the same session greeting again keeps its record; a new one, once the first is stale, starts fresh', () => {
  const { clock, now } = clockAt()
  const hub = createHub({ now, staleMs: 5_000 })
  const { client: first } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' } })
  hub.addRuns(first, [{ seq: 1 }], null)
  const { client: again } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' } })
  assert.equal(hub.snapshot().runs.length, 1)
  assert.equal(hub.next(first), undefined, 'the older client id is forgotten')
  assert.equal(hub.next(again), null)

  clock.now += 6_000
  assert.equal(typeof hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-2' } }).client, 'string')
  assert.equal(hub.snapshot().runs.length, 0)
})

test('another session is refused while the one served still polls, so two sessions cannot take turns', () => {
  const { clock, now } = clockAt()
  const hub = createHub({ now, staleMs: 5_000 })
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' } })
  hub.addRuns(client, [{ seq: 1 }], null)

  clock.now += 4_000
  assert.match(hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-2' } }).error, /serving session s-1/)
  assert.equal(hub.next(client), null, 'the session served keeps its client id')
  clock.now += 4_000
  assert.match(
    hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-2' } }).error,
    /serving session s-1/,
    'its poll kept it fresh',
  )
  assert.equal(hub.snapshot().runs.length, 1)
  assert.equal(hub.snapshot().session.facts.id, 's-1')
})

test('a session that stops polling goes stale, and a job it took and never answered is lost', () => {
  const { clock, now } = clockAt()
  const hub = createHub({ now, staleMs: 5_000, jobTimeoutMs: 30_000 })
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })
  const { job } = hub.enqueue('clock.now', {})
  hub.next(client)

  clock.now += 6_000
  assert.equal(hub.snapshot().session.isConnected, false)
  assert.match(hub.enqueue('clock.now', {}).error, /no session is connected/)

  clock.now += 30_000
  const lost = hub.snapshot().jobs.find(one => one.id === job)
  assert.equal(lost.status, 'lost')
})

test('a probe the session did not offer is refused', () => {
  const hub = createHub()
  hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })
  assert.match(hub.enqueue('process.kill', {}).error, /no probe named process\.kill/)
})

test('a command from the page reaches the session as text, and its answer comes back on the job', () => {
  const hub = createHub()
  const events = []
  hub.subscribe((type, data) => events.push([type, data]))

  assert.match(hub.enqueueCommand('intercept fs.read refuse').error, /no session is connected/)
  const { client } = hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 's-1' },
    probes: PROBES,
    interceptable: ['fs.read'],
  })
  const { job } = hub.enqueueCommand(' intercept fs.read refuse ')

  assert.deepEqual(hub.next(client), { id: job, kind: 'command', text: 'intercept fs.read refuse' })
  assert.equal(hub.answer(client, job, 'answer-h1'), true)
  const done = events.filter(([type]) => type === 'job').at(-1)[1]
  assert.equal(done.status, 'done')
  assert.equal(done.answer, 'answer-h1')
})

test('a command longer than a typed line is refused before it is queued', () => {
  const hub = createHub()
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })

  assert.match(hub.enqueueCommand(`fs.read ${'x'.repeat(5_000)}`).error, /at most/)
  assert.equal(hub.next(client), null)
})

test('the events a session can intercept are kept from its hello', () => {
  const hub = createHub()

  hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 's-1' },
    probes: PROBES,
    interceptable: ['fs.read', 'fs.stat'],
  })

  assert.deepEqual(hub.snapshot().session.interceptable, ['fs.read', 'fs.stat'])
})

test('taps are kept once each, and each mirrored value replaced whole, until another session greets', () => {
  const { clock, now } = clockAt()
  const hub = createHub({ now, staleMs: 5_000 })
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })

  hub.addTaps(client, [{ seq: 1 }, { seq: 2 }])
  hub.addTaps(client, [{ seq: 2 }, { seq: 3 }])
  hub.mirror(client, 'intercepts', [{ event: 'fs.read' }])
  hub.mirror(client, 'intercepts', [{ event: 'fs.stat' }])
  hub.mirror(client, 'spend', { totals: { p: { calls: 2 } } })
  assert.equal(hub.snapshot().mirror.spend.totals.p.calls, 2)

  assert.deepEqual(
    hub.snapshot().taps.map(tap => tap.seq),
    [1, 2, 3],
  )
  assert.deepEqual(hub.snapshot().mirror.intercepts, [{ event: 'fs.stat' }])

  clock.now += 6_000
  hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-2' }, probes: PROBES })
  assert.deepEqual(hub.snapshot().taps, [])
  assert.deepEqual(hub.snapshot().mirror, {})
})

test('a mirrored value needs a plain key, and an unknown client none', () => {
  const hub = createHub()
  const client = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES }).client

  assert.equal(hub.mirror(client, '__proto__', 1), null)
  assert.equal(hub.mirror(client, 'Spend', 1), null)
  assert.equal(hub.mirror('client-x9', 'spend', 1), false)
  for (let index = 0; index < 16; index += 1)
    assert.equal(hub.mirror(client, `key${'abcdefghijklmnop'[index]}`, index), true)
  assert.equal(hub.mirror(client, 'oneMore', 1), null, 'no more than sixteen keys')
  assert.equal(hub.mirror(client, 'keya', 2), true, 'a key already kept is replaced')
})

test('a reload goes to the session as its own kind of job, and settled waits for its answer', async () => {
  const hub = createHub()
  assert.match(hub.enqueueReload().error, /no session is connected/)

  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' }, probes: PROBES })
  const { job } = hub.enqueueReload()
  assert.deepEqual(hub.next(client), { id: job, kind: 'reload' })
  const waiting = hub.settled(job, 1_000)
  hub.answer(client, job, 'Reloaded: 7 plugins')
  assert.equal((await waiting).answer, 'Reloaded: 7 plugins')
  assert.equal((await hub.settled(job, 1_000)).status, 'done', 'a job already answered settles at once')
  assert.equal(await hub.settled('no-such-job', 1_000), null)

  const unanswered = hub.enqueueReload().job
  assert.equal(await hub.settled(unanswered, 10), null, 'null once the wait runs out')
})

test("the bridge's protocol number is the server's: a change lands on both sides at once", () => {
  const bridge = readFileSync(new URL('../../mods/mod-lab-bridge/hooks/bridge.ts', import.meta.url), 'utf8')
  assert.equal(Number(/^export const PROTOCOL = (\d+)$/m.exec(bridge)?.[1]), BRIDGE_PROTOCOL)
})

test('a bridge with another protocol number is refused, told which side to update, and shown to the page until it stops', () => {
  const { clock, now } = clockAt()
  const hub = createHub({ now, staleMs: 5_000 })
  const events = []
  hub.subscribe((type, data) => events.push([type, data]))

  const older = hub.hello({ protocol: BRIDGE_PROTOCOL - 1, session: { id: 's-1' } })
  assert.equal(older.error, protocolMessage(BRIDGE_PROTOCOL - 1))
  assert.match(older.error, /claude plugin update.*\/reload-plugins/)
  assert.deepEqual(hub.snapshot().mismatch, {
    protocol: BRIDGE_PROTOCOL - 1,
    expected: BRIDGE_PROTOCOL,
    message: older.error,
    at: 1_000,
  })
  assert.equal(hub.snapshot().session, null)
  assert.match(hub.enqueue('fs.read', {}).error, /no session is connected/)

  // Greeting again every few seconds keeps the refusal; the page hears of it once.
  clock.now += 3_000
  hub.hello({ protocol: BRIDGE_PROTOCOL - 1, session: { id: 's-1' } })
  clock.now += 9_000
  assert.notEqual(hub.snapshot().mismatch, null)
  clock.now += 2_000
  assert.equal(hub.snapshot().mismatch, null, 'dropped once that bridge stopped greeting')
  assert.deepEqual(
    events.map(([type, data]) => [type, data?.protocol ?? null]),
    [
      ['mismatch', BRIDGE_PROTOCOL - 1],
      ['mismatch', null],
    ],
  )

  assert.match(
    hub.hello({ session: { id: 's-1' } }).error,
    /sends no bridge protocol number .*: update the lab's plugins/,
  )
  assert.match(
    hub.hello({ protocol: BRIDGE_PROTOCOL + 1 }).error,
    /: update the explorer with npx claude-mod-lab@latest$/,
  )
  assert.equal(hub.snapshot().mismatch.protocol, BRIDGE_PROTOCOL + 1)
  const { client } = hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' } })
  assert.equal(typeof client, 'string')
  assert.equal(hub.snapshot().mismatch, null, 'a bridge that is let in clears it')
})

test("the session's record keeps the bridge's and the lab's roots from the hello", () => {
  const hub = createHub()
  hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 's-1' },
    plugin: { name: 'mod-lab-bridge', root: '/plugins/mod-lab-bridge' },
    lab: { root: '/plugins/mod-lab' },
  })
  const { session } = hub.snapshot()
  assert.deepEqual([session.plugin.root, session.lab.root], ['/plugins/mod-lab-bridge', '/plugins/mod-lab'])
  hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 's-1' } })
  assert.equal(hub.snapshot().session.lab, null)
})

test("the session's record keeps the hello's engine and compat.json, the entries of another shape left out", () => {
  const hub = createHub()
  hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 's-1', version: '2.1.303' },
    engine: { version: '2.1.303', surfaces: ['terminal', 7] },
    compat: {
      floor: '2.1.299',
      testedThrough: '2.1.303',
      plugins: { 'paint-mod': { since: '2.1.300', uses: ['PromptDecoration.virtualText'] }, broken: { since: 'soon' } },
      capabilities: { 'future.thing': { since: '2.1.310', uses: ['future.thing'] } },
    },
  })
  const { session } = hub.snapshot()
  assert.deepEqual(session.engine, { version: '2.1.303', surfaces: ['terminal'] })
  assert.deepEqual(session.compat, {
    floor: '2.1.299',
    testedThrough: '2.1.303',
    plugins: { 'paint-mod': { since: '2.1.300', uses: ['PromptDecoration.virtualText'] } },
    capabilities: { 'future.thing': { since: '2.1.310', uses: ['future.thing'] } },
  })

  // A bridge that sends neither, or a compat.json without its range, leaves them null.
  hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 's-1' },
    engine: { surfaces: [] },
    compat: { floor: '2.1.299' },
  })
  assert.deepEqual([hub.snapshot().session.engine, hub.snapshot().session.compat], [null, null])
  assert.equal(compatOf(null), null)
})
