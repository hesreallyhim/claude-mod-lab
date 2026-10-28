import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BRIDGE_PROTOCOL, createHub } from '../lib/hub.mjs'
import { initializeProjectLessons } from '../lib/roots.mjs'
import { createWorkspaceContext } from '../lib/workspace-context.mjs'
import { startServer } from '../server.mjs'

async function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-context-')))
  let time = 0
  const hub = createHub({ now: () => time })
  const server = await startServer({ port: 0, hub, pluginRoots: [], skillBases: [], ...options })
  t.after(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })
  const get = path => fetch(`${server.url}${path}`, { headers: { 'x-lab-token': server.token } })
  const post = (path, body) =>
    fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { 'x-lab-token': server.token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const hello = async (project, lessons = null, extraLab = {}) => {
    time += 10_000
    const response = await fetch(`${server.url}/bridge/hello`, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: BRIDGE_PROTOCOL,
        session: { id: `session-${time}`, cwd: project },
        lab: { lessons, ...extraLab },
      }),
    })
    assert.equal(response.status, 200)
  }
  const folder = name => {
    const path = join(root, name)
    mkdirSync(path)
    return path
  }
  return {
    root,
    hub,
    server,
    get,
    post,
    hello,
    folder,
    expire: () => {
      time += 10_000
    },
  }
}

test('a standalone explorer can browse every Build page without selecting or creating a workspace', async t => {
  const { root, get, post } = await fixture(t)
  const previous = process.cwd()
  process.chdir(root)
  t.after(() => process.chdir(previous))
  assert.deepEqual(await (await get('/api/context')).json(), {
    project: null,
    lessonWorkspace: null,
    protocol: BRIDGE_PROTOCOL,
  })
  assert.equal((await get('/api/catalog')).status, 503)
  for (const path of ['/api/lessons', '/api/lesson?id=tick', '/api/sandbox', '/api/workshop', '/api/components']) {
    const response = await get(path)
    assert.equal(response.status, 200, path)
    const body = await response.json()
    assert.equal(body.lessonWorkspace, null, path)
  }
  const lesson = await (await get('/api/lesson?id=tick')).json()
  assert.deepEqual([lesson.folder, lesson.check, lesson.isStarted], [null, null, false])
  assert.equal((await get('/api/lesson/watch?id=tick')).status, 400)
  for (const path of [
    '/api/lesson/start?id=tick',
    '/api/check?id=tick',
    '/api/sandbox/save',
    '/api/sandbox/test',
    '/api/workshop/switch',
  ]) {
    const response = await post(path, {})
    assert.equal(response.status, 400, path)
    assert.match((await response.json()).error, /init-lessons/)
  }
  assert.deepEqual(readdirSync(root), [])
})

test('component writes follow the connected project and reject a stale page before copying', async t => {
  const installed = async () => ({ copies: [{ id: 'brackets-mod@test', scope: 'user' }], problem: null })
  const { root, get, post, hello, folder } = await fixture(t, { installed })
  const first = folder('first')
  const second = folder('second')
  await hello(first)
  const firstView = await (await get('/api/components')).json()
  assert.equal(firstView.dir, join(first, '.claude', 'skills'))
  await hello(second)
  const refused = await post('/api/components/add', { name: 'brackets-mod', project: first })
  assert.equal(refused.status, 400)
  assert.match((await refused.json()).error, /project changed/)
  assert.deepEqual(readdirSync(first), [])
  assert.deepEqual(readdirSync(second), [])
  const accepted = await post('/api/components/add', { name: 'brackets-mod', project: second })
  assert.equal(accepted.status, 200)
  assert.equal(existsSync(join(second, '.claude', 'skills', 'brackets-mod', 'hooks', 'register.tsx')), true)
  assert.equal(existsSync(join(root, '.claude')), false)
  assert.deepEqual(readdirSync(first), [])
})

test('an explicitly configured server project never overrides an attached project', async t => {
  const old = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-old-project-')))
  t.after(() => rmSync(old, { recursive: true, force: true }))
  const { get, hello, folder } = await fixture(t, { workspace: old })
  assert.equal((await (await get('/api/context')).json()).project, old)
  const current = folder('current')
  await hello(current)
  assert.equal((await (await get('/api/components')).json()).dir, join(current, '.claude', 'skills'))
  assert.deepEqual(readdirSync(old), [])
})

test('lessons require an initialized root explicitly advertised by the connected session', async t => {
  const { get, hello, folder } = await fixture(t)
  const project = folder('project')
  mkdirSync(join(project, '.claude-mod-lab'))
  mkdirSync(join(project, 'workshop'))
  await hello(project)
  assert.equal(
    (await (await get('/api/context')).json()).lessonWorkspace,
    null,
    'a marker alone does not enable lessons',
  )
  await hello(project, project)
  assert.equal((await (await get('/api/context')).json()).lessonWorkspace, project)
  const response = await get(`/api/lesson/watch?id=tick&lessonWorkspace=${encodeURIComponent(project)}`)
  const reader = response.body.getReader()
  await reader.read()
  assert.deepEqual(readdirSync(join(project, '.claude-mod-lab')), [], 'watching does not record progress')
  const other = folder('other')
  await hello(other, project)
  assert.equal(
    (await (await get('/api/context')).json()).lessonWorkspace,
    null,
    'another project cannot adopt the lesson root',
  )
  assert.equal((await reader.read()).done, true, 'changing context closes the old lesson watch')
  assert.deepEqual(readdirSync(join(project, '.claude-mod-lab')), [])
})

test('opening a lesson watch never repairs a deleted workshop directory', async t => {
  const { get, hello, folder } = await fixture(t)
  const project = folder('lessons')
  mkdirSync(join(project, '.claude-mod-lab'))
  await hello(project, project)
  const response = await get(`/api/lesson/watch?id=tick&lessonWorkspace=${encodeURIComponent(project)}`)
  const reader = response.body.getReader()
  await reader.read()
  assert.equal(existsSync(join(project, 'workshop')), false)
  assert.deepEqual(readdirSync(join(project, '.claude-mod-lab')), [])
  await reader.cancel()
})

test('the home directory can be inspected but cannot become a lesson or component destination', () => {
  const hub = createHub()
  hub.hello({ protocol: BRIDGE_PROTOCOL, session: { id: 'home', cwd: homedir() }, lab: { lessons: homedir() } })
  const context = createWorkspaceContext({ hub })
  assert.equal(context.snapshot().lessonWorkspace, null)
  assert.equal(context.snapshot().project, realpathSync(homedir()))
  assert.throws(() => context.requireProject(realpathSync(homedir())), /home folder/)
  assert.throws(() => createWorkspaceContext({ hub, lessonWorkspace: homedir() }), /init-lessons/)
})

test('a connected session with no valid project never falls back to the server startup directory', async t => {
  const old = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-fallback-')))
  t.after(() => rmSync(old, { recursive: true, force: true }))
  const { get, post, hello } = await fixture(t, { workspace: old })
  await hello(undefined)
  assert.equal((await (await get('/api/context')).json()).project, null)
  assert.equal((await post('/api/components/add', { name: 'brackets-mod', project: old })).status, 400)
  assert.deepEqual(readdirSync(old), [])
})

for (const sameProject of [false, true]) {
  test(`a session replacement during component preflight cannot write (${sameProject ? 'same' : 'different'} project)`, async t => {
    let release = () => {}
    const held = new Promise(resolve => {
      release = () => resolve(undefined)
    })
    let started = () => {}
    const pending = new Promise(resolve => {
      started = () => resolve(undefined)
    })
    const installed = async () => {
      started()
      await held
      return { copies: [], problem: null }
    }
    const { post, hello, folder } = await fixture(t, { installed })
    const project = folder('first')
    const next = sameProject ? project : folder('next')
    await hello(project)
    const response = post('/api/components/add', { name: 'brackets-mod', project })
    await pending
    await hello(next)
    release()
    assert.equal((await response).status, 400)
    assert.deepEqual(readdirSync(project), [])
    assert.deepEqual(readdirSync(next), [])
  })
}

test('a lesson watch closes when its connected session expires', async t => {
  const { get, hello, folder, expire } = await fixture(t)
  const project = folder('lessons')
  mkdirSync(join(project, '.claude-mod-lab'))
  mkdirSync(join(project, 'workshop'))
  await hello(project, project)
  const response = await get(`/api/lesson/watch?id=tick&lessonWorkspace=${encodeURIComponent(project)}`)
  const reader = response.body.getReader()
  await reader.read()
  expire()
  assert.equal((await reader.read()).done, true)
  assert.deepEqual(readdirSync(join(project, '.claude-mod-lab')), [])
})

test('a session can enable lessons and load their editable source through its existing collection', async t => {
  const lessonChecks = { poke() {}, close() {}, watch() {}, check() {} }
  const { get, post, hello, folder } = await fixture(t, { lessonChecks })
  const project = folder('in-session')
  const collection = join(project, '.claude', 'mod-lab')
  mkdirSync(collection, { recursive: true })
  writeFileSync(join(project, 'README.md'), 'existing project')
  await hello(project)
  assert.equal((await (await get('/api/context')).json()).lessonWorkspace, null)
  initializeProjectLessons(project)
  await hello(project, project, { lessonCollection: collection, componentDirs: [collection] })
  assert.equal((await (await get('/api/context')).json()).lessonWorkspace, project)
  const response = await post('/api/lesson/start?id=tick', { lessonWorkspace: project })
  assert.equal(response.status, 200)
  assert.equal(readlinkSync(join(collection, 'tick')), '../../workshop/tick')
  assert.equal(realpathSync(join(collection, 'tick')), join(project, 'workshop', 'tick'))
  assert.equal(readFileSync(join(project, 'README.md'), 'utf8'), 'existing project')
  assert.equal(existsSync(join(project, 'solutions', 'tick', '.claude-plugin')), false)
  assert.equal((await post('/api/lesson/start?id=tick', { lessonWorkspace: project })).status, 200)
})

test('an occupied lesson link refuses Start before copying a starter or solution', async t => {
  const { post, hello, folder } = await fixture(t)
  const project = folder('occupied')
  const collection = join(project, '.claude', 'mod-lab')
  mkdirSync(collection, { recursive: true })
  writeFileSync(join(collection, 'tick'), 'keep me')
  initializeProjectLessons(project)
  await hello(project, project, { lessonCollection: collection, componentDirs: [collection] })
  const response = await post('/api/lesson/start?id=tick', { lessonWorkspace: project })
  assert.equal(response.status, 400)
  assert.equal(readFileSync(join(collection, 'tick'), 'utf8'), 'keep me')
  assert.equal(existsSync(join(project, 'workshop', 'tick')), false)
  assert.equal(existsSync(join(project, 'solutions')), false)
})
