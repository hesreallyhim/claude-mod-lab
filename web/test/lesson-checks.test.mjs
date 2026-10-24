import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createLessonChecks } from '../lib/lesson-checks.mjs'
import { readProgress, recordCheck } from '../lib/progress.mjs'
import { startServer } from '../server.mjs'

const QUIET = 50

function workspace() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-checks-')))
  mkdirSync(join(dir, 'workshop'))
  return dir
}

/** A checker stand-in that records each check it runs in the workspace's state, as learn/check.mjs does. */
function fakeChecker(dir, { hold = null } = {}) {
  const ran = []
  const run = async id => {
    ran.push(id)
    if (hold !== null) await hold
    const report = `report ${ran.length} on ${id}`
    recordCheck(dir, id, { passed: ran.length, total: 9, report })
    return report
  }
  return { ran, run }
}

async function until(what, check, ms = 5_000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(done => setTimeout(done, 20))
  }
}

const pause = ms => new Promise(done => setTimeout(done, ms))

test("a save in the open lesson's folder is checked once it is quiet; saves elsewhere and the engine's own writes are not", async () => {
  const dir = workspace()
  const mod = join(dir, 'workshop', 'tick')
  mkdirSync(join(mod, 'hooks'), { recursive: true })
  mkdirSync(join(mod, '.claude-plugin'))
  mkdirSync(join(dir, 'workshop', 'other'))
  // macOS reports to a new watch what was made just before it started.
  await pause(200)
  const { ran, run } = fakeChecker(dir)
  const checks = createLessonChecks({ workspace: dir, run, quietMs: QUIET })
  const events = []
  const stop = checks.watch({ id: 'tick', mod: 'tick' }, event => events.push(event))
  try {
    await pause(100)
    writeFileSync(join(mod, 'hooks', 'register.ts'), 'one')
    writeFileSync(join(mod, 'hooks', 'register.ts'), 'two')
    await until('a check', () => events.some(event => event.type === 'checked'))
    assert.deepEqual(ran, ['tick'], 'two writes in quick succession are one check')
    assert.deepEqual(events.at(-1), {
      type: 'checked',
      report: 'report 1 on tick',
      progress: { passed: 1, total: 9, at: readProgress(dir).lessons.tick.at },
    })

    writeFileSync(join(dir, 'workshop', 'other', 'register.ts'), 'not this lesson')
    mkdirSync(join(mod, '.claude-plugin', 'types'))
    writeFileSync(join(mod, '.claude-plugin', 'types', 'index.d.ts'), 'laid by the engine')
    writeFileSync(join(mod, 'tsconfig.json'), '{}')
    await pause(400)
    assert.deepEqual(ran, ['tick'])
  } finally {
    stop()
  }
  writeFileSync(join(mod, 'hooks', 'register.ts'), 'after the page closed')
  await pause(300)
  assert.deepEqual(ran, ['tick'], 'a closed page watches nothing')
})

test('a lesson whose folder is not there yet is checked once the folder appears, and on saves in it after that', async () => {
  const dir = workspace()
  const { ran, run } = fakeChecker(dir)
  const checks = createLessonChecks({ workspace: dir, run, quietMs: QUIET })
  const stop = checks.watch({ id: 'stopwatch', mod: 'stopwatch' }, () => {})
  try {
    await pause(100)
    mkdirSync(join(dir, 'workshop', 'stopwatch', '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, 'workshop', 'stopwatch', '.claude-plugin', 'plugin.json'), '{}')
    await until('the first check', () => ran.length === 1)
    await pause(200)
    writeFileSync(join(dir, 'workshop', 'stopwatch', '.claude-plugin', 'plugin.json'), '{ "name": "stopwatch" }')
    await until('a check of the save', () => ran.length === 2)
  } finally {
    stop()
  }
})

test("a save that another session's explorer is checking is not checked again: its result is taken from the state", async () => {
  const dir = workspace()
  /** @type {(value?: unknown) => void} */
  let release
  const first = fakeChecker(dir, { hold: new Promise(done => (release = done)) })
  const second = fakeChecker(dir)
  const one = createLessonChecks({ workspace: dir, run: first.run, quietMs: QUIET })
  const other = createLessonChecks({ workspace: dir, run: second.run, quietMs: QUIET })
  const lesson = { id: 'tick', mod: 'tick' }
  const events = []
  const stop = other.watch(lesson, event => events.push(event))
  try {
    // The same save, seen by both; the first explorer checks it at once.
    other.poke(lesson)
    const checking = one.check(lesson)
    await until('the first check to hold the lock', () => first.ran.length === 1)
    await pause(300)
    assert.deepEqual(second.ran, [], 'the second explorer runs no check of its own while the lock is held')
    release()
    const mine = await checking
    await until("the second explorer's result", () => events.some(event => event.type === 'checked'))
    assert.equal(events.at(-1).report, mine.report)
    assert.deepEqual(second.ran, [])
    assert.equal(existsSync(join(dir, '.claude-mod-lab', 'check.lock')), false, 'the lock is let go')
  } finally {
    stop()
  }
})

test('a lock left by a process that is gone is taken over', async () => {
  const dir = workspace()
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
  mkdirSync(join(dir, '.claude-mod-lab'))
  const lock = { pid: Number(gone.stdout), token: 'old', lesson: 'tick', at: Date.now() }
  writeFileSync(join(dir, '.claude-mod-lab', 'check.lock'), JSON.stringify(lock))
  const { ran, run } = fakeChecker(dir)
  const checked = await createLessonChecks({ workspace: dir, run, quietMs: QUIET }).check({ id: 'tick', mod: 'tick' })
  assert.deepEqual(ran, ['tick'])
  assert.equal(checked.report, 'report 1 on tick')
})

test("the lesson page's start makes the folder of a lesson without a starter, with its manifest, and the page is sent its check", async () => {
  const dir = workspace()
  const { ran, run } = fakeChecker(dir)
  const lessonChecks = createLessonChecks({ workspace: dir, run, quietMs: QUIET })
  mkdirSync(join(dir, '.claude-mod-lab'))
  const server = await startServer({ port: 0, workspace: dir, lessonWorkspace: dir, lessonChecks, pluginRoots: [] })
  const headers = { 'x-lab-token': server.token }
  try {
    const before = await (await fetch(`${server.url}/api/lesson?id=stopwatch`, { headers })).json()
    assert.deepEqual(
      [before.folder, before.isStarted, before.hasStarter],
      [join(dir, 'workshop', 'stopwatch'), false, false],
    )

    const page = await fetch(`${server.url}/api/lesson/watch?id=stopwatch&lessonWorkspace=${encodeURIComponent(dir)}`, {
      headers,
    })
    const reader = page.body.getReader()
    let sent = ''
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        sent += Buffer.from(value).toString('utf8')
      }
    })()
    assert.equal(readProgress(dir).current, null, 'browsing does not record lesson progress')

    const start = () =>
      fetch(`${server.url}/api/lesson/start?id=stopwatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lessonWorkspace: dir }),
      })
    assert.equal((await (await start()).json()).made, 'manifest')
    const manifest = JSON.parse(
      readFileSync(join(dir, 'workshop', 'stopwatch', '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    assert.equal(manifest.name, 'stopwatch')
    await until('the check sent to the page', () => sent.includes('event: checked'))
    assert.deepEqual(ran, ['stopwatch'])
    assert.match(sent, /"report":"report 1 on stopwatch"/)
    assert.equal((await (await start()).json()).made, null, 'a folder that is there is left as it is')
    await reader.cancel()
    await reading
  } finally {
    await server.close()
  }
})
