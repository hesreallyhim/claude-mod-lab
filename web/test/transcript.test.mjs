import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { findRecord, isUuid, transcriptPath } from '../lib/transcript.mjs'

const dir = mkdtempSync(join(tmpdir(), 'mod-lab-transcript-'))

after(() => rmSync(dir, { recursive: true, force: true }))

test("the transcript's path names the session's folder with its directory's separators and dots turned into hyphens", () => {
  const path = transcriptPath({ cwd: '/Users/me/code/my.project', sessionId: 'abc-1', configDir: '/cfg' })
  assert.equal(path, '/cfg/projects/-Users-me-code-my-project/abc-1.jsonl')
  assert.ok(transcriptPath({ cwd: '/a', sessionId: 's' }).endsWith('/projects/-a/s.jsonl'))
})

test('a row id is a uuid; anything else is refused before the file is read', () => {
  assert.equal(isUuid('53874b9f-f9db-459b-8459-3c9ae2d1e0ea'), true)
  assert.equal(isUuid('../other'), false)
  assert.equal(isUuid(''), false)
  assert.equal(isUuid(null), false)
})

test('a record is found by its uuid with its line, lines that are not JSON passed over, and a missing one is null', async () => {
  const path = join(dir, 'session.jsonl')
  const wanted = { uuid: '53874b9f-f9db-459b-8459-3c9ae2d1e0ea', type: 'assistant', message: { content: [] } }
  writeFileSync(
    path,
    [
      JSON.stringify({ type: 'mode', mode: 'default' }),
      'not json at all 53874b9f-f9db-459b-8459-3c9ae2d1e0ea',
      JSON.stringify({ uuid: 'other', note: 'mentions 53874b9f-f9db-459b-8459-3c9ae2d1e0ea in a field' }),
      JSON.stringify(wanted),
      JSON.stringify({ uuid: 'later' }),
    ].join('\n'),
  )
  assert.deepEqual(await findRecord(path, wanted.uuid), { record: wanted, line: 4 })
  assert.equal(await findRecord(path, '00000000-0000-0000-0000-000000000000'), null)
  mkdirSync(join(dir, 'empty'))
  assert.equal(await findRecord(join(dir, 'empty', 'none.jsonl'), wanted.uuid), null)
})
