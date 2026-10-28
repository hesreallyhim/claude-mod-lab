import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { lab } from './kit'

const CWD = '/projects/example project'
const SHARED = '/home/user/.claude-mod-lab/examples'
const LOCAL = `${CWD}/.claude/mod-lab`

function setup(on: On, directories: string[] = [SHARED], response?: { isError: boolean; text: string }) {
  mock.env(on, { MOD_LAB_COMPONENT_DIRS: JSON.stringify(directories) })
  on('session.cwd', () => ({ value: CWD }))
  const calls: Record<string, unknown>[] = []
  on('mcp.call', ($, e) => {
    expect(e.server).toBe('plugin:mod-lab-bridge:explorer')
    expect(e.tool).toBe('add-example')
    calls.push(e.args)
    const answer = response ?? { isError: false, text: JSON.stringify({
      name: e.args.name,
      directory: e.args.scope === 'local' ? LOCAL : SHARED,
      command: e.args.name === 'gallery-mod' ? 'mod-gallery' : e.args.name,
      howToTry: e.args.name === 'gallery-mod' ? '/mod-gallery opens every technique in one pane.' : null,
    }) }
    return { value: { content: [{ type: 'text', text: answer.text }], isError: answer.isError } }
  })
  return calls
}

test('/mod-lab add gallery copies the shared gallery and explains activation', async ($, on) => {
  const calls = setup(on)
  const answer = await $.command.run(lab('add gallery'))
  expect(calls).toEqual([{ cwd: CWD, name: 'gallery-mod', scope: 'shared' }])
  expect(answer.text).toContain(`Added gallery-mod to ${SHARED}/gallery-mod`)
  expect(answer.text).toContain('This session watches that folder')
  expect(answer.text).toContain('/mod-gallery')
})

test('local examples use full names and explain restarting when their collection is not watched', async ($, on) => {
  const calls = setup(on)
  const answer = await $.command.run(lab('add raster-mod --local'))
  expect(calls).toEqual([{ cwd: CWD, name: 'raster-mod', scope: 'local' }])
  expect(answer.text).toContain(`Added raster-mod to ${LOCAL}/raster-mod`)
  expect(answer.text).toContain('npx claude-mod-lab run --local')
  expect(answer.text).toContain('/raster-mod')
})

test('local flag may precede the example and watched local copies load automatically', async ($, on) => {
  const calls = setup(on, [LOCAL])
  const answer = await $.command.run(lab('add --local gallery'))
  expect(calls).toEqual([{ cwd: CWD, name: 'gallery-mod', scope: 'local' }])
  expect(answer.text).toContain('This session watches that folder')
})

test('add usage and help explain scope; invalid arguments do not copy files', async ($, on) => {
  const calls = setup(on)
  for (const command of ['add', 'add --local', 'add gallery --force', 'add gallery --local --local', 'add --unknown']) {
    expect((await $.command.run(lab(command))).text).toContain('Use /mod-lab add <example> [--local]')
  }
  expect((await $.command.run(lab('help add'))).text).toContain('~/.claude-mod-lab/examples/')
  expect(calls).toEqual([])
})

test('a refused copy reports failure without claiming the plugin loaded', async ($, on) => {
  setup(on, [], { isError: true, text: 'your edited copy is already there' })
  const answer = await $.command.run(lab('add gallery'))
  expect(answer.text).toContain('The example was not added: your edited copy is already there')
})

test('unexpected bridge output is reported as a failed add', async ($, on) => {
  setup(on, [], { isError: false, text: '{}' })
  expect((await $.command.run(lab('add gallery'))).text).toContain('The bridge returned no example details')
})
