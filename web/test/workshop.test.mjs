import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { BRIDGE_PROTOCOL } from '../lib/hub.mjs'
import { effectsOf, listWorkshop, SETTINGS, switchMod } from '../lib/workshop.mjs'
import { startServer } from '../server.mjs'

const LESSONS = [
  { id: 'chime', mod: 'chime', title: 'A chime', steps: [{ title: 'a' }, { title: 'b', calls: ['$.audio.speak'] }] },
  { id: 'triage', mod: 'triage', title: 'Triage', steps: [{ title: 'a', calls: ['$.model.complete'] }] },
  { id: 'stopwatch', mod: 'stopwatch', title: 'One', steps: [{ title: 'a' }] },
  { id: 'stopwatch-pane', mod: 'stopwatch', title: 'Two', steps: [{ title: 'a', calls: ['$.clock.every'] }] },
]

/** A workspace whose workshop/ holds a mod folder for each name, with a manifest naming it, and a folder without one. */
function workspaceWith(...names) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-workshop-')))
  for (const name of names) {
    mkdirSync(join(dir, 'workshop', name, '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, 'workshop', name, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
  }
  mkdirSync(join(dir, 'workshop', 'notes'), { recursive: true })
  return dir
}

const settingsOf = dir => JSON.parse(readFileSync(join(dir, SETTINGS), 'utf8'))

test("a lesson's mod is said to make model calls or play sound where its steps name such a call on $", () => {
  assert.deepEqual(effectsOf([LESSONS[0]]), ['plays sound'])
  assert.deepEqual(effectsOf([LESSONS[1]]), ['makes model calls'])
  assert.deepEqual(effectsOf(LESSONS.slice(2)), [])
})

test('the workshop lists each folder with a manifest, with the lessons that build it, all on at first', () => {
  const dir = workspaceWith('stopwatch', 'triage', 'sandbox-mod')
  const mods = listWorkshop(dir, LESSONS)
  assert.deepEqual(
    mods.map(mod => [mod.name, mod.isOn, mod.lessons.map(lesson => lesson.id), mod.effects]),
    [
      ['sandbox-mod', true, [], []],
      ['stopwatch', true, ['stopwatch', 'stopwatch-pane'], []],
      ['triage', true, ['triage'], ['makes model calls']],
    ],
  )
})

test('a switch turns a mod off for the workspace with <name>@inline false in its local settings, and on again, keeping the rest', () => {
  const dir = workspaceWith('chime', 'triage')
  mkdirSync(join(dir, '.claude'))
  writeFileSync(
    join(dir, SETTINGS),
    JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'x@y': true } }),
  )

  assert.equal(switchMod(dir, LESSONS, 'chime', false).isOn, false)
  assert.deepEqual(settingsOf(dir), {
    permissions: { allow: ['Bash(ls)'] },
    enabledPlugins: { 'x@y': true, 'chime@inline': false },
  })
  assert.deepEqual(
    listWorkshop(dir, LESSONS).map(mod => [mod.name, mod.isOn]),
    [
      ['chime', false],
      ['triage', true],
    ],
  )

  assert.equal(switchMod(dir, LESSONS, 'chime', true).isOn, true)
  assert.deepEqual(settingsOf(dir), { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'x@y': true } })
})

test('a switch refuses a name that is no workshop mod, and settings it cannot read, which it leaves as they are', () => {
  const dir = workspaceWith('chime')
  assert.throws(() => switchMod(dir, LESSONS, 'mod-lab', false), /no mod in workshop\/ is named mod-lab/)
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, SETTINGS), '{ "permissions": ')
  assert.throws(() => switchMod(dir, LESSONS, 'chime', false), /not a JSON object/)
  assert.equal(readFileSync(join(dir, SETTINGS), 'utf8'), '{ "permissions": ')
})

test("the Workshop page's switch has the session in the workspace reload", async () => {
  const dir = workspaceWith('tick')
  mkdirSync(join(dir, '.claude-mod-lab'), { recursive: true })
  const server = await startServer({ port: 0, workspace: dir, lessonWorkspace: dir, pluginRoots: [] })
  try {
    const page = { 'x-lab-token': server.token, 'content-type': 'application/json' }
    const bridge = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }
    const listed = await (await fetch(`${server.url}/api/workshop`, { headers: page })).json()
    assert.deepEqual(
      listed.mods.map(mod => mod.name),
      ['tick'],
    )
    const hello = await fetch(`${server.url}/bridge/hello`, {
      method: 'POST',
      headers: bridge,
      body: JSON.stringify({ protocol: BRIDGE_PROTOCOL, session: { id: 'session-ws', cwd: dir } }),
    })
    const { client } = await hello.json()
    const switching = fetch(`${server.url}/api/workshop/switch`, {
      method: 'POST',
      headers: page,
      body: JSON.stringify({ name: 'tick', isOn: false, lessonWorkspace: dir }),
    })
    let job = null
    while (job === null) {
      const next = await fetch(`${server.url}/bridge/next?client=${client}`, { headers: bridge })
      if (next.status === 200) job = (await next.json()).job
    }
    assert.equal(job.kind, 'reload')
    await fetch(`${server.url}/bridge/answer`, {
      method: 'POST',
      headers: bridge,
      body: JSON.stringify({ client, job: job.id, text: 'Reloaded: 5 plugins' }),
    })
    const switched = await (await switching).json()
    assert.deepEqual([switched.mod.isOn, switched.reload.isReloaded], [false, true])
    assert.equal(settingsOf(dir).enabledPlugins['tick@inline'], false)
  } finally {
    await server.close()
  }
})
