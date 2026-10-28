import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { lab, slash } from './kit'

const CWD = '/projects/lesson project'
const COLLECTION = `${CWD}/.claude/mod-lab`
const SERVER = 'plugin:mod-lab-bridge:explorer'

function setup(on: On, variables: Record<string, string> = {}, failure?: string) {
  mock.env(on, { MOD_LAB_COMPONENT_DIRS: JSON.stringify([COLLECTION]), ...variables })
  on('session.cwd', () => ({ value: CWD }))
  const calls: string[] = []
  on('mcp.call', ($, e) => {
    calls.push(e.tool)
    expect(e.server).toBe(SERVER)
    if (failure) return { value: { content: [{ type: 'text', text: failure }], isError: true } }
    if (e.tool === 'init-lessons') {
      expect(e.args.cwd).toBe(CWD)
      if (variables.MOD_LAB_LESSONS !== CWD) expect(e.args.collection).toBe(COLLECTION)
      return { value: { content: [{ type: 'text', text: JSON.stringify({ workspace: CWD }) }], isError: false } }
    }
    return { value: { content: [{ type: 'text', text: 'The explorer is at http://localhost:4999.' }], isError: false } }
  })
  return calls
}

test('/init-lessons enables the current project and links to Lessons without starting another process', async ($, on) => {
  const calls = setup(on)
  const writes: Record<string, string | undefined> = {}
  on('env.set', ($, e) => {
    writes[e.name] = e.value
    return { value: {} }
  })
  on('process.run', () => { throw new Error('initialization must not launch another process') })
  const answer = await $.command.run(slash('init-lessons', ''))
  expect(answer.text).toContain(`Lessons enabled in ${CWD}`)
  expect(answer.text).toContain('http://localhost:4999/#learn')
  expect(writes).toEqual({ MOD_LAB_LESSON_COLLECTION: COLLECTION, MOD_LAB_LESSONS: CWD })
  expect(calls).toEqual(['init-lessons', 'start'])
})

test('already loaded lesson workspaces do not acquire another loading path', async ($, on) => {
  setup(on, { MOD_LAB_LESSONS: CWD, MOD_LAB_COMPONENT_DIRS: '[]' })
  const writes: string[] = []
  on('env.set', ($, e) => { writes.push(e.name); return { value: {} } })
  expect((await $.command.run(lab('init-lessons'))).text).toContain('Lessons enabled')
  expect(writes).toEqual(['MOD_LAB_LESSONS'])
})

test('unsupported sessions and unexpected arguments do not create files', async ($, on) => {
  const calls = setup(on, { MOD_LAB_COMPONENT_DIRS: '[]' })
  expect((await $.command.run(slash('init-lessons', ''))).text).toContain('npx claude-mod-lab run')
  expect((await $.command.run(slash('init-lessons', 'another-folder'))).text).toContain('without arguments')
  expect(calls).toEqual([])
})

test('a failed initializer does not mark lessons enabled', async ($, on) => {
  setup(on, {}, 'workshop is a file')
  on('env.set', () => { throw new Error('must not change the environment after failure') })
  expect((await $.command.run(slash('init-lessons', ''))).text).toContain('Lessons were not enabled: workshop is a file')
})

test('a denied session update is reported rather than claiming lessons are active', async ($, on) => {
  setup(on)
  on('env.set', () => ({ value: { deny: 'blocked by policy' } }))
  expect((await $.command.run(slash('init-lessons', ''))).text).toContain('blocked by policy')
})
