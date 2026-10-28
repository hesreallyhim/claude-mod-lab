import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Run the server with an isolated HOME: its shared destination is intentionally
// derived from the real process environment, just as it is in a launcher session.
async function exercise(serverUrl, root) {
  /** @type {typeof import('node:assert/strict')} */
  const assert = (await import('node:assert/strict')).default
  const { existsSync, mkdirSync, readdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { startServer } = await import(serverUrl)
  const { createHub, BRIDGE_PROTOCOL } = await import(new URL('./lib/hub.mjs', serverUrl).href)
  const { sharedComponentFolder, componentFolder } = await import(
    new URL('./lib/component-folders.mjs', serverUrl).href
  )
  const shared = sharedComponentFolder()
  const first = join(root, 'first')
  const second = join(root, 'second')
  const lessons = join(root, 'home', '.claude-mod-lab', 'projects', 'fixture', 'lessons')
  for (const dir of [shared, first, second, lessons]) mkdirSync(dir, { recursive: true })
  const typesPath = join(root, 'types.d.ts')
  writeFileSync(typesPath, "declare module 'claude-code' { export interface CoreEngineInterface {} }\n")
  let time = 0
  let client
  let project
  const hub = createHub({ now: () => time })
  const server = await startServer({
    port: 0,
    hub,
    typesPath,
    pluginRoots: [],
    skillBases: [],
    installed: async () => ({ copies: [], problem: null }),
  })
  const connect = (cwd, examplesDir) => {
    time += 10_000
    project = cwd
    client = hub.hello({
      protocol: BRIDGE_PROTOCOL,
      session: { id: `session-${time}`, cwd },
      lab: { examplesDir, lessonCollection: lessons, componentDirs: [lessons, examplesDir] },
    }).client
    assert.ok(client)
  }
  const request = async (path = '', body, expectedStatus = 200) => {
    const response = await fetch(`${server.url}/api/components${path}`, {
      headers: { 'x-lab-token': server.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify({ project, ...body }) }),
    })
    const value = await response.json()
    assert.equal(response.status, expectedStatus, JSON.stringify(value))
    return value
  }
  const reloads = setInterval(() => {
    if (!client) return
    const job = hub.next(client)
    if (job) hub.answer(client, job.id, 'Reloaded examples')
  }, 5)
  try {
    connect(first, shared)
    const listed = await request()
    assert.equal(listed.dir, shared)
    assert.equal(listed.components.find(one => one.name === 'brackets-mod').scope, 'shared')
    assert.deepEqual(
      listed.components.find(one => one.name === 'brackets-mod').destinations.map(one => one.scope),
      ['shared', 'local'],
    )
    const added = await request('/add', { name: 'brackets-mod', directory: shared, scope: 'shared' })
    assert.deepEqual(
      [added.component.directory, added.component.scope, added.component.isAdded],
      [shared, 'shared', true],
    )
    assert.equal(added.reload.isReloaded, true)
    assert.ok(existsSync(join(shared, 'brackets-mod', '.claude-plugin', 'plugin.json')))
    connect(second, shared)
    const reused = (await request()).components.find(one => one.name === 'brackets-mod')
    assert.deepEqual([reused.directory, reused.scope, reused.isAdded], [shared, 'shared', true])
    assert.deepEqual(readdirSync(first), [])
    assert.deepEqual(readdirSync(second), [])
    const local = componentFolder(second)
    const localCopy = await request('/add', { name: 'brackets-mod', directory: local, scope: 'local' })
    assert.deepEqual([localCopy.component.directory, localCopy.component.scope], [local, 'local'])
    assert.equal(localCopy.reload.isReloaded, false)
    assert.match(localCopy.reload.note, /npx claude-mod-lab run --local/)
    assert.equal(hub.snapshot().jobs.filter(job => job.status === 'queued').length, 0)
    hub.mirror(client, 'commands', [{ name: 'brackets-mod', plugin: 'brackets-mod' }])
    const copies = (await request()).components.find(one => one.name === 'brackets-mod').destinations
    assert.deepEqual(
      copies.map(one => one.isAdded),
      [true, true],
    )
    writeFileSync(join(local, 'brackets-mod', 'my-notes.txt'), 'keep this')
    const refused = await request('/remove', { name: 'brackets-mod', directory: local, scope: 'local' })
    assert.equal(refused.component.isRefused, true)
    connect(first, shared)
    const removed = await request('/remove', { name: 'brackets-mod', directory: shared })
    assert.deepEqual(
      [removed.component.directory, removed.component.scope, removed.component.isAdded],
      [shared, 'shared', false],
    )
    assert.equal(existsSync(join(shared, 'brackets-mod')), false)
    assert.ok(existsSync(join(local, 'brackets-mod', '.claude-plugin', 'plugin.json')))
    assert.deepEqual(readdirSync(lessons), [], 'a lesson loading collection is not an examples destination')
    connect(join(root, 'home'), shared)
    const homeCopies = (await request()).components.find(one => one.name === 'brackets-mod').destinations
    assert.equal(homeCopies[0].scope, 'shared')
    assert.match(homeCopies[1].unavailable, /home folder/)
    const homeAdded = await request('/add', { name: 'brackets-mod', scope: 'shared', directory: shared })
    assert.equal(homeAdded.component.isAdded, true)
    assert.equal(homeAdded.reload.isReloaded, true)
    const homeLocal = await request(
      '/add',
      { name: 'brackets-mod', scope: 'local', directory: componentFolder(join(root, 'home')) },
      400,
    )
    assert.match(homeLocal.error, /home folder/)
  } finally {
    clearInterval(reloads)
    await server.close()
  }
}

test('Explorer shares examples across projects and keeps explicit local copies separate', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shared-examples-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  mkdirSync(home)
  const script = join(root, 'exercise.mjs')
  writeFileSync(
    script,
    `await (${exercise.toString()})(${JSON.stringify(new URL('../server.mjs', import.meta.url).href)}, ${JSON.stringify(root)});\n`,
  )
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, HOME: home, MOD_LAB_WORKSPACE: '', MOD_LAB_LESSONS: '' },
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
})
