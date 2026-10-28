import type { CommandInfo, On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { PROTOCOL } from '../hooks/bridge'

const HOME = '/home/tester-r2'
const FILE = `${HOME}/.claude-mod-lab/bridge.json`
const URL = 'http://127.0.0.1:47123'
const TOKEN = 'token-k7'
const TICK = 400
// While it has no explorer the bridge looks for one every eighth tick.
const IDLE = TICK * 8
// The explorer's MCP server, as /mcp lists it.
const SERVER = 'plugin:mod-lab-bridge:explorer'

type Request = { path: string; method: string; body: unknown; auth: string | undefined }
type Answer = { status: number; text: string }

/**
 * A pretend explorer server, answered from the bottom of http.fetch at its
 * `url`, each request recorded; nothing answers at another address. Its bridge
 * file, the shared one an override may also name, exists while `hasFile` and `isUp`.
 */
function server(on: On, answers: { hello?: () => Answer; next?: () => Answer } = {}) {
  // `fileUrl` is what the bridge file names, where that is not the server itself: a file left by an explorer that has gone.
  const state = { url: URL, token: TOKEN, isUp: true, hasFile: false, fileUrl: null as string | null, requests: [] as Request[] }
  on('fs.exists', ($, e) => ({ value: state.hasFile && state.isUp && e.path === FILE }))
  on('fs.read', () => ({ value: JSON.stringify({ url: state.fileUrl ?? state.url, token: state.token }) }))
  on('http.fetch', ($, e) => {
    if (!state.isUp || !e.url.startsWith(state.url)) return { deny: `nothing answers at ${e.url}` }
    const path = e.url.slice(state.url.length)
    const body = e.init?.body === undefined ? undefined : JSON.parse(e.init.body)
    state.requests.push({ path, method: e.init?.method ?? 'GET', body, auth: e.init?.headers?.authorization })
    const answer = path.startsWith('/bridge/hello')
      ? (answers.hello?.() ?? { status: 200, text: JSON.stringify({ client: `client-${state.requests.length}` }) })
      : path.startsWith('/bridge/next')
        ? (answers.next?.() ?? { status: 204, text: '' })
        : { status: 200, text: '{}' }
    return { value: { ...answer, ok: answer.status < 300, headers: {} } }
  })
  return state
}

/**
 * The explorer's MCP server, answered from the bottom of mcp.connect and
 * mcp.call: connected or not, and whether its explorer serves (at the pretend
 * server's address) or idles. Its endpoint tool holds its answer for the
 * `wait` asked while the explorer idles, as the server does, on `clock`. Each
 * tool called is recorded.
 */
function mcpServer(on: On, explorer: { url: string; token: string }, clock?: ReturnType<typeof mock.clock>) {
  const mcp = { isConnected: true, isServing: true, called: [] as string[] }
  on('mcp.connect', () => ({
    value: mcp.isConnected ? { isConnected: true, server: SERVER } : { isConnected: false, reason: 'failed', message: `The MCP server "${SERVER}" did not connect` },
  }))
  on('mcp.call', async ($, e) => {
    mcp.called.push(`${e.server} ${e.tool}`)
    if (!mcp.isConnected) return { deny: `no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
    for (let waited = 0; clock !== undefined && !mcp.isServing && waited < Number(e.args.wait ?? 0) * 1000; waited += TICK) await clock.sleep(TICK)
    const answer = mcp.isServing ? { state: 'serving', url: explorer.url, token: explorer.token, page: 'http://localhost:47123' } : { state: 'idle' }
    return { value: { content: [{ type: 'text', text: JSON.stringify(answer) }], isError: false } }
  })
  return mcp
}

/** The session's facts; answers the status line, keeping what was shown. `env` adds variables beside HOME. */
function session(on: On, env: Record<string, string> = {}) {
  const statuses: unknown[] = []
  mock.env(on, { HOME, ...env })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-q1' }))
  on('session.cwd', () => ({ value: '/work/q1' }))
  on('session.model', () => ({ value: 'model-q1' }))
  on('session.version', () => ({ value: { version: '9.9.9' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.status', ($, e) => {
    statuses.push(e)
    return { value: undefined }
  })
  return { statuses }
}

const START = { cwd: '/work/q1', surface: 'terminal', isInteractive: true } as const
const hellos = (requests: readonly Request[]) => requests.filter(request => request.path === '/bridge/hello')
const commandSnapshots = (requests: readonly Request[]) => requests
  .filter(request => request.path === '/bridge/mirror' && (request.body as { key: string }).key === 'commands')
  .map(request => (request.body as { value: unknown }).value)

test("the bridge finds its session's explorer through the MCP server, says hello with the session, then answers a job", async ($, on) => {
  const clock = mock.clock(on)
  session(on, { MOD_LAB_LESSONS: '/work/q1' })
  const explorerServer = serving(on, [{ id: 'job-5', probe: 'session.cwd', args: {} }])
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK)
  await clock.advance(TICK)

  const [helloRequest, ...rest] = explorerServer.requests
  expect(helloRequest).toMatchObject({ path: '/bridge/hello', method: 'POST', auth: `Bearer ${TOKEN}` })
  expect(helloRequest?.body).toMatchObject({ protocol: PROTOCOL, session: { id: 'session-q1', cwd: '/work/q1', model: 'model-q1', version: '9.9.9' } })
  expect(helloRequest?.body).toMatchObject({ engine: { version: '9.9.9', surfaces: ['terminal'] } })
  expect(helloRequest?.body).toMatchObject({ lab: { lessons: '/work/q1', componentDirs: [] } })
  // Without the lab there is no root of its to report.
  expect(helloRequest?.body).toMatchObject({ lab: { root: null } })
  const answered = rest.find(request => request.path === '/bridge/runs')
  // The kit loads no dependency, so $.lab is absent here and the job is answered as not run.
  expect(answered?.body).toMatchObject({ job: 'job-5', runs: [{ probe: 'session.cwd', ok: false }] })
  expect(JSON.stringify(answered?.body)).toContain('the lab did not run it')
})

for (const [given, expected] of [
  [JSON.stringify(['/work/q1/.claude-mod-lab/components', '/work/q1/.claude/skills/gallery-mod']), ['/work/q1/.claude-mod-lab/components', '/work/q1/.claude/skills/gallery-mod']],
  [JSON.stringify(['/work/q1/components', 'relative/path', null, 42, '/bad\0path']), ['/work/q1/components']],
  ['not JSON', []],
  [JSON.stringify({ directory: '/work/q1/components' }), []],
] as const) {
  test(`the bridge validates explicit component directories in its greeting: ${given}`, async ($, on) => {
    const clock = mock.clock(on)
    session(on, { MOD_LAB_COMPONENT_DIRS: given })
    const explorerServer = serving(on, [])
    mcpServer(on, explorerServer)

    await $.session.start(START)
    await clock.advance(TICK)

    expect(hellos(explorerServer.requests)[0]?.body).toMatchObject({ lab: { componentDirs: expected } })
  })
}

test('while the explorer idles the bridge waits on one call to its server rather than asking every few seconds, and greets it once it serves', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  const mcp = mcpServer(on, explorerServer, clock)
  mcp.isServing = false

  await $.session.start(START)
  await clock.advance(60_000)
  expect(explorerServer.requests).toEqual([])
  expect(mcp.called.length).toBeLessThan(3)

  mcp.isServing = true
  await clock.advance(TICK * 2)
  expect(hellos(explorerServer.requests)).toHaveLength(1)
})

test('a server that has not connected yet is asked again until it has', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  const mcp = mcpServer(on, explorerServer)
  mcp.isConnected = false

  await $.session.start(START)
  await clock.advance(TICK * 20)
  expect(explorerServer.requests).toEqual([])

  mcp.isConnected = true
  await clock.advance(IDLE)
  expect(hellos(explorerServer.requests)).toHaveLength(1)
})

test('after a reload restarts the server on another port, the bridge finds it again and greets it', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK * 2)
  expect(hellos(explorerServer.requests)).toHaveLength(1)

  // The old address stops answering; the MCP server's endpoint names the new one.
  explorerServer.url = 'http://127.0.0.1:47124'
  explorerServer.token = 'token-k8'
  await clock.advance(TICK + IDLE)

  const [again] = hellos(explorerServer.requests).slice(1)
  expect(again).toMatchObject({ auth: 'Bearer token-k8' })
})

test("the bridgeFile option is an override: the bridge connects to the server its file names, not the session's own", { options: { bridgeFile: '~/.claude-mod-lab/bridge.json' } }, async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  explorerServer.hasFile = true
  mcpServer(on, { url: 'http://127.0.0.1:47199', token: 'token-in-session' })

  await $.session.start(START)
  await clock.advance(TICK * 2)

  expect(hellos(explorerServer.requests)).toEqual([expect.objectContaining({ auth: `Bearer ${TOKEN}` })])
})

test('MOD_LAB_BRIDGE_FILE is an override too, and with no explorer writing it the bridge sends nothing', async ($, on) => {
  const clock = mock.clock(on)
  session(on, { MOD_LAB_BRIDGE_FILE: FILE })
  const explorerServer = server(on)
  explorerServer.hasFile = true
  explorerServer.isUp = false
  mcpServer(on, { url: 'http://127.0.0.1:47199', token: 'token-in-session' })

  await $.session.start(START)
  await clock.advance(TICK * 20)
  expect(explorerServer.requests).toEqual([])

  explorerServer.isUp = true
  await clock.advance(IDLE)
  expect(hellos(explorerServer.requests)).toEqual([expect.objectContaining({ auth: `Bearer ${TOKEN}` })])
})

test('with no explorer of its own open, the bridge joins the one behind the shared bridge file (claude-mod-lab serve) at once, without waiting on its server', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  explorerServer.hasFile = true
  const mcp = mcpServer(on, { url: 'http://127.0.0.1:47199', token: 'token-in-session' }, clock)
  mcp.isServing = false

  await $.session.start(START)
  await clock.advance(TICK * 2)

  expect(hellos(explorerServer.requests)).toEqual([expect.objectContaining({ auth: `Bearer ${TOKEN}` })])
  // Its own server was asked once whether it serves now, and not held waiting.
  expect(mcp.called).toHaveLength(1)
})

test("a shared bridge file nothing answers behind is passed over for the session's own explorer", async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  explorerServer.hasFile = true
  explorerServer.fileUrl = 'http://127.0.0.1:1'
  mcpServer(on, explorerServer, clock)

  await $.session.start(START)
  await clock.advance(TICK * 2)

  expect(hellos(explorerServer.requests)).toEqual([expect.objectContaining({ auth: `Bearer ${TOKEN}` })])
})

test("a session the launcher asked to open its own explorer (MOD_LAB_OPEN) waits for it, and leaves the shared file alone", async ($, on) => {
  const clock = mock.clock(on)
  session(on, { MOD_LAB_OPEN: '1' })
  const explorerServer = server(on)
  explorerServer.hasFile = true
  const mcp = mcpServer(on, explorerServer, clock)
  mcp.isServing = false

  await $.session.start(START)
  await clock.advance(TICK * 4)
  expect(explorerServer.requests).toEqual([])

  mcp.isServing = true
  await clock.advance(TICK * 2)
  expect(hellos(explorerServer.requests)).toHaveLength(1)
})

test('a server that refuses the greeting is greeted again later, and no connection is shown', async ($, on) => {
  const clock = mock.clock(on)
  const { statuses } = session(on)
  const reason = 'the explorer is serving session other-s9; it takes another once that one stops'
  const explorerServer = server(on, { hello: () => ({ status: 409, text: JSON.stringify({ error: reason }) }) })
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK * 20)

  expect(explorerServer.requests.every(request => request.path === '/bridge/hello')).toBe(true)
  expect(explorerServer.requests.length).toBeGreaterThan(1)
  expect(JSON.stringify(statuses)).not.toContain('explorer:')
})

test('a server that forgot this client is greeted again', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on, { next: () => ({ status: 410, text: '' }) })
  mcpServer(on, explorerServer)

  await $.session.start(START)
  // Connect on the first tick, lose the connection on the second, greet again a full idle interval later.
  await clock.advance(TICK * 9)
  expect(hellos(explorerServer.requests)).toHaveLength(1)
  await clock.advance(TICK)
  expect(hellos(explorerServer.requests)).toHaveLength(2)
})

test('taps are forwarded once each, and each mirrored value of the lab, intercepts and spend, whenever it changes', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  mcpServer(on, explorerServer)
  const lab = {
    taps: [{ seq: 1, event: 'fs.read', origin: 'neighbor-t1' }],
    intercepts: [{ event: 'fs.read', behavior: 'watch' }],
    spend: { calls: [], totals: { 'plugin-s1': { calls: 1 } } },
  }
  on('state.get', { plugin: 'mod-lab', key: 'taps' }, () => ({ value: { value: lab.taps, version: 1 } }))
  on('state.get', { plugin: 'mod-lab', key: 'intercepts' }, () => ({ value: { value: lab.intercepts, version: 1 } }))
  on('state.get', { plugin: 'mod-lab', key: 'spend' }, () => ({ value: { value: lab.spend as never, version: 1 } }))

  await $.session.start(START)
  await clock.advance(TICK * 3)
  lab.taps = [...lab.taps, { seq: 2, event: 'fs.read', origin: 'neighbor-t2' }]
  lab.intercepts = []
  lab.spend = { calls: [], totals: { 'plugin-s1': { calls: 2 } } }
  await clock.advance(TICK * 3)

  const bodies = (path: string) => explorerServer.requests.filter(request => request.path === path).map(request => request.body)
  expect(bodies('/bridge/taps')).toEqual([
    { client: expect.any(String), taps: [{ seq: 1, event: 'fs.read', origin: 'neighbor-t1' }] },
    { client: expect.any(String), taps: [{ seq: 2, event: 'fs.read', origin: 'neighbor-t2' }] },
  ])
  const mirrored = (key: string) => bodies('/bridge/mirror').filter(body => (body as { key: string }).key === key).map(body => (body as { value: unknown }).value)
  expect(mirrored('intercepts')).toEqual([[{ event: 'fs.read', behavior: 'watch' }], []])
  expect(mirrored('spend').map(value => (value as { totals: Record<string, { calls: number }> }).totals['plugin-s1']?.calls)).toEqual([1, 2])
})

test('command availability preserves plugin identity, polls modestly, and mirrors removal and lookup failures', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = server(on)
  mcpServer(on, explorerServer)
  const gallery: CommandInfo = { name: 'mod-gallery', description: 'Gallery', source: 'plugin', plugin: 'gallery-mod' }
  let commands: CommandInfo[] = [gallery, { name: 'help', description: 'Help', source: 'builtin' }]
  let isUnavailable = false
  let calls = 0
  on('command.list', () => {
    calls++
    if (isUnavailable) throw new Error('command registry unavailable')
    return { value: commands }
  })

  await $.session.start(START)
  await clock.advance(TICK * 2)
  expect(commandSnapshots(explorerServer.requests)).toEqual([[{ name: 'mod-gallery', plugin: 'gallery-mod' }, { name: 'help', plugin: null }]])
  await clock.advance(TICK * 7)
  expect(calls).toBe(1)
  await clock.advance(TICK)
  expect(calls).toBe(2)
  expect(commandSnapshots(explorerServer.requests)).toHaveLength(1)

  commands = []
  await clock.advance(TICK * 8)
  expect(commandSnapshots(explorerServer.requests).at(-1)).toEqual([])
  isUnavailable = true
  await clock.advance(TICK * 8)
  expect(commandSnapshots(explorerServer.requests).at(-1)).toBe(null)
})

/** Stands for mod-lab: adds $.lab, whose methods answer from their input, so a test can see what reached them. */
const labStandIn: Plugin = {
  name: 'lab-stand-in',
  register(on) {
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const lab = {
        run: async () => ({}),
        probes: async () => [],
        command: async (input: { text: string; from?: string }) => `did ${input.text}, from ${input.from}`,
        interceptable: async () => ['fs.read'],
        root: async () => '/plugins/mod-lab-r3',
      }
      return { ...built, lab: lab as never }
    })
  },
}

/** A server whose next answers the given jobs once each, then nothing. */
function serving(on: On, jobs: unknown[]) {
  return server(on, {
    next: () => {
      const job = jobs.shift()
      return job === undefined ? { status: 204, text: '' } : { status: 200, text: JSON.stringify({ job }) }
    },
  })
}

test("a command job's text reaches $.lab.command, and its answer goes back on the job; the hello names the lab's root", { plugins: [labStandIn] }, async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = serving(on, [{ id: 'job-c5', kind: 'command', text: 'intercept fs.read refuse' }])
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK * 2)

  const hello = explorerServer.requests.find(request => request.path === '/bridge/hello')
  expect(hello?.body).toMatchObject({ interceptable: ['fs.read'], lab: { root: '/plugins/mod-lab-r3' } })
  const answered = explorerServer.requests.find(request => request.path === '/bridge/answer')
  expect(answered?.body).toMatchObject({ job: 'job-c5', text: 'did intercept fs.read refuse, from explorer' })
})

test('enabling lessons refreshes the connected session before polling without resending captured state', { plugins: [labStandIn] }, async ($, on) => {
  const clock = mock.clock(on)
  let lessons: string | undefined
  let collection: string | undefined
  let reads = 0
  on('env.get', { name: 'MOD_LAB_LESSONS' }, () => {
    reads += 1
    return { value: lessons }
  })
  on('env.get', { name: 'MOD_LAB_LESSON_COLLECTION' }, () => ({ value: collection }))
  session(on)
  on('state.get', { plugin: 'mod-lab', key: 'runs' }, () => ({ value: { value: [{ seq: 1, probe: 'session.cwd', ok: true }] as never, version: 1 } }))
  on('state.get', { plugin: 'mod-lab', key: 'traces' }, () => ({ value: { value: [{ seq: 1, event: 'session.start' }] as never, version: 1 } }))
  on('state.get', { plugin: 'mod-lab', key: 'taps' }, () => ({ value: { value: [{ seq: 1, event: 'fs.read' }] as never, version: 1 } }))
  on('state.get', { plugin: 'mod-lab', key: 'intercepts' }, () => ({ value: { value: [], version: 1 } }))
  const jobs: unknown[] = []
  const explorerServer = serving(on, jobs)
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK * 2)
  const readsAfterConnection = reads
  expect(readsAfterConnection).toBeGreaterThan(0)
  await clock.advance(TICK * 7)
  expect(reads).toBe(readsAfterConnection)
  expect(hellos(explorerServer.requests)).toHaveLength(1)

  lessons = '/work/q1'
  collection = '/work/q1/.claude/mod-lab'
  jobs.push({ id: 'after-init', kind: 'command', text: 'list' })
  await clock.advance(TICK)

  const greetings = hellos(explorerServer.requests)
  expect(greetings).toHaveLength(2)
  expect(greetings[1]?.body).toMatchObject({ lab: { lessons, lessonCollection: collection } })
  const changedAt = explorerServer.requests.indexOf(greetings[1]!)
  const client = `client-${changedAt + 1}`
  expect(explorerServer.requests[changedAt + 1]?.path).toBe(`/bridge/next?client=${client}`)
  expect(explorerServer.requests.find(request => request.path === '/bridge/answer')?.body).toMatchObject({ client, job: 'after-init', text: 'did list, from explorer' })
  for (const path of ['/bridge/runs', '/bridge/traces', '/bridge/taps']) {
    expect(explorerServer.requests.filter(request => request.path === path)).toHaveLength(1)
  }
  expect(explorerServer.requests.filter(request => request.path === '/bridge/mirror' && (request.body as { key: string }).key === 'intercepts')).toHaveLength(1)

  collection = undefined
  await clock.advance(TICK * 8)
  expect(hellos(explorerServer.requests)).toHaveLength(3)
  expect(hellos(explorerServer.requests).at(-1)?.body).toMatchObject({ lab: { lessons, lessonCollection: null } })
})

test('a command job is answered with text, here that the absent lab did not answer', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = serving(on, [{ id: 'job-c4', kind: 'command', text: 'ledger' }])
  mcpServer(on, explorerServer)

  await $.session.start(START)
  await clock.advance(TICK * 2)

  const answered = explorerServer.requests.find(request => request.path === '/bridge/answer')
  expect(answered?.body).toMatchObject({ job: 'job-c4', text: expect.stringContaining('the lab did not answer') })
})

test('a pending reload answers with the refreshed client after lessons are enabled', async ($, on) => {
  const clock = mock.clock(on)
  let lessons: string | undefined
  on('env.get', { name: 'MOD_LAB_LESSONS' }, () => ({ value: lessons }))
  session(on)
  const explorerServer = serving(on, [{ id: 'pending-reload', kind: 'reload' }])
  mcpServer(on, explorerServer)
  let finishReload!: () => void
  const reload = new Promise<void>(done => { finishReload = done })
  on('command.run', { command: 'reload-plugins' }, async () => {
    await reload
    return { text: 'reloaded' }
  })

  await $.session.start(START)
  await clock.advance(TICK * 2)
  lessons = '/work/q1'
  await clock.advance(TICK * 8)
  const refreshed = hellos(explorerServer.requests)[1]!
  expect(refreshed).toBeDefined()
  const client = `client-${explorerServer.requests.indexOf(refreshed) + 1}`
  finishReload()
  await clock.advance(TICK)
  expect(explorerServer.requests.find(request => request.path === '/bridge/answer')?.body).toMatchObject({ client, job: 'pending-reload', text: 'reloaded' })
})

test('a reload job mirrors refreshed command availability before answering the reload', async ($, on) => {
  const clock = mock.clock(on)
  session(on)
  const explorerServer = serving(on, [{ id: 'job-r1', kind: 'reload' }])
  mcpServer(on, explorerServer)
  let commands: CommandInfo[] = []
  on('command.list', () => ({ value: commands }))
  on('command.run', { command: 'reload-plugins' }, async () => {
    commands = [{ name: 'mod-gallery', description: 'Gallery', source: 'plugin', plugin: 'gallery-mod' }]
    return { text: 'Reloaded: 7 plugins' }
  })

  await $.session.start(START)
  await clock.advance(TICK * 2)

  const answered = explorerServer.requests.find(request => request.path === '/bridge/answer')
  expect(answered?.body).toMatchObject({ job: 'job-r1', text: 'Reloaded: 7 plugins' })
  const beforeAnswer = explorerServer.requests.slice(0, explorerServer.requests.indexOf(answered!))
  expect(commandSnapshots(beforeAnswer).at(-1)).toEqual([{ name: 'mod-gallery', plugin: 'gallery-mod' }])
})
