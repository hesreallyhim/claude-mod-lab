import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openLesson, progressFile, readProgress, recordCheck } from '../lib/progress.mjs'

const workspace = () => mkdtempSync(join(tmpdir(), 'mod-lab-progress-'))

test("a workspace's lesson state is in .claude-mod-lab/progress.json, and empty until something is written", () => {
  const dir = workspace()
  assert.equal(progressFile(dir), join(dir, '.claude-mod-lab', 'progress.json'))
  assert.deepEqual(readProgress(dir), { current: null, lessons: {} })
  mkdirSync(join(dir, '.claude-mod-lab'))
  writeFileSync(progressFile(dir), '{ not json')
  assert.deepEqual(readProgress(dir), { current: null, lessons: {} })
})

test('a check is recorded with its report, and its lesson becomes the current one; the others are kept', () => {
  const dir = workspace()
  recordCheck(dir, 'tick', { passed: 1, total: 3, report: 'tick: 1 of 3' }, 1000)
  recordCheck(dir, 'egg', { passed: 2, total: 2, report: 'egg: done' }, 2000)
  assert.deepEqual(readProgress(dir), {
    current: 'egg',
    lessons: {
      tick: { passed: 1, total: 3, at: 1000, report: 'tick: 1 of 3' },
      egg: { passed: 2, total: 2, at: 2000, report: 'egg: done' },
    },
  })
  assert.deepEqual(JSON.parse(readFileSync(progressFile(dir), 'utf8')), readProgress(dir), 'the file is plain JSON')
})

test('opening a lesson makes it the current one and leaves the checks as they were', () => {
  const dir = workspace()
  recordCheck(dir, 'tick', { passed: 1, total: 3, report: 'r' }, 1000)
  openLesson(dir, 'stopwatch')
  assert.equal(readProgress(dir).current, 'stopwatch')
  assert.deepEqual(Object.keys(readProgress(dir).lessons), ['tick'])
})
