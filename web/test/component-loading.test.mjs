import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { componentFolder } from '../lib/component-folders.mjs'
import { copyMod } from '../lib/components.mjs'
import { BRIDGE_PROTOCOL } from '../lib/hub.mjs'
import { PACKAGE_ROOT } from '../lib/roots.mjs'
import { startServer } from '../server.mjs'

async function withProject(check) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'component-loading-')))
  const typesPath = join(project, 'types.d.ts')
  writeFileSync(typesPath, "declare module 'claude-code' { export interface CoreEngineInterface {} }\n")
  const collection = componentFolder(project)
  mkdirSync(collection, { recursive: true })
  let scans = 0
  const server = await startServer({
    port: 0,
    typesPath,
    workspace: project,
    installed: async () => {
      scans++
      return { copies: [], problem: 'Project skills were suppressed because this workspace is untrusted.' }
    },
  })
  const request = async (path, body) => {
    const response = await fetch(`${server.url}/api/components${path}`, {
      headers: { 'x-lab-token': server.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify({ project, ...body }) }),
    })
    return response.json()
  }
  try {
    await check({ project, collection, server, request, scans: () => scans })
  } finally {
    await server.close()
    rmSync(project, { recursive: true, force: true })
  }
}

function connect(server, project, componentDirs) {
  return server.hub.hello({
    protocol: BRIDGE_PROTOCOL,
    session: { id: 'component-test', cwd: project },
    lab: { componentDirs },
  }).client
}

async function withReload(server, client, action, commands = undefined) {
  const timer = setInterval(() => {
    const job = server.hub.next(client)
    if (job) {
      if (commands !== undefined) server.hub.mirror(client, 'commands', commands)
      server.hub.answer(client, job.id, 'Reloaded components')
    }
  }, 5)
  try {
    return await action()
  } finally {
    clearInterval(timer)
  }
}

test('launcher collection accepts a new mod and reloads without treating project-skills suppression as a blocker', async () => {
  await withProject(async ({ project, collection, server, request, scans }) => {
    const client = connect(server, project, [collection])
    const added = await withReload(
      server,
      client,
      () => request('/add', { name: 'gallery-mod', directory: collection }),
      [{ name: 'mod-gallery', plugin: 'gallery-mod' }],
    )
    assert.equal(added.component.directory, collection)
    assert.equal(added.component.isAdded, true)
    assert.equal(added.reload.isReloaded, true)
    assert.equal(added.component.commandAvailable, true)
    assert.equal(existsSync(join(collection, 'gallery-mod', '.claude-plugin', 'plugin.json')), true)
    const listed = await request('')
    assert.equal(listed.components.find(one => one.name === 'gallery-mod').loadProblem, null)
    assert.equal(scans(), 0, 'a separate CLI scan cannot describe the running session’s explicit plugins')
    const removed = await withReload(server, client, () =>
      request('/remove', { name: 'gallery-mod', directory: collection }),
    )
    assert.equal(removed.component.isAdded, false)
    assert.equal(existsSync(join(collection, 'gallery-mod')), false)
  })
})

test('legacy copies keep their edits and actual destination; removal and re-add use the new collection', async () => {
  await withProject(async ({ project, collection, server, request }) => {
    const legacy = join(project, '.claude', 'skills')
    const mod = join(legacy, 'gallery-mod')
    copyMod(join(PACKAGE_ROOT, 'mods', 'gallery-mod'), mod)
    writeFileSync(join(mod, 'my-notes.txt'), 'keep this')
    const client = connect(server, project, [collection, mod])
    const list = await request('')
    const gallery = list.components.find(one => one.name === 'gallery-mod')
    assert.equal(gallery.directory, legacy)
    assert.equal(gallery.isEdited, true)
    assert.equal(gallery.loadProblem, null)
    const refused = await request('/remove', { name: 'gallery-mod', directory: legacy })
    assert.equal(refused.component.isRefused, true)
    assert.equal(readFileSync(join(mod, 'my-notes.txt'), 'utf8'), 'keep this')
    const removed = await withReload(server, client, () =>
      request('/remove', { name: 'gallery-mod', directory: legacy, force: true }),
    )
    assert.equal(removed.component.directory, collection)
    const stale = await request('/add', { name: 'gallery-mod', directory: legacy })
    assert.match(stale.error, /destination changed/)
    const added = await withReload(server, client, () =>
      request('/add', { name: 'gallery-mod', directory: collection }),
    )
    assert.equal(added.component.directory, collection)
    assert.equal(added.component.isEdited, false)
  })
})

test('a collection without matching session metadata explains how to launch it and does not claim a reload', async () => {
  await withProject(async ({ project, collection, server, request }) => {
    connect(server, project, [join(project, 'some-other-folder')])
    const added = await request('/add', { name: 'gallery-mod', directory: collection })
    assert.equal(added.component.isAdded, true)
    assert.equal(added.reload.isReloaded, false)
    assert.match(added.component.loadProblem, /npx claude-mod-lab run/)
    assert.equal(server.hub.snapshot().jobs.length, 0)
  })
})

test('session command status verifies the providing plugin and distinguishes failed checks from absence', async () => {
  await withProject(async ({ project, collection, server, request }) => {
    copyMod(join(PACKAGE_ROOT, 'mods', 'gallery-mod'), join(collection, 'gallery-mod'))
    const client = connect(server, project, [collection])
    const gallery = async () => (await request('')).components.find(one => one.name === 'gallery-mod')
    assert.equal((await gallery()).commandAvailable, null)
    server.hub.mirror(client, 'commands', [{ name: 'mod-gallery', plugin: 'gallery-mod' }])
    assert.equal((await gallery()).commandAvailable, true)
    server.hub.mirror(client, 'commands', [{ name: 'mod-gallery', plugin: 'other-mod' }])
    assert.equal((await gallery()).commandAvailable, false)
    server.hub.mirror(client, 'commands', [])
    assert.equal((await gallery()).commandAvailable, false)
    server.hub.mirror(client, 'commands', null)
    assert.equal((await gallery()).commandAvailable, null)
  })
})
