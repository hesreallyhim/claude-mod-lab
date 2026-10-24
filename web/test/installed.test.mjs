import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installedCopies, sessionCopyNote, sideloadRefusal, skillsCopyNote } from '../lib/installed.mjs'

// `claude plugin list --json` as 2.1.303 prints it, run in /work: enabled is answered for that folder.
// /work is trusted, so the copies in its .claude/skills/ are listed too, as <name>@skills-dir.
const LISTED = JSON.stringify([
  { id: 'brackets-mod@claude-mod-lab', version: '0.1.0', scope: 'user', enabled: true },
  {
    id: 'keycast-mod@skills-dir',
    version: '0.1.0',
    scope: 'project',
    enabled: true,
    installPath: '/work/.claude/skills/keycast-mod',
  },
  { id: 'keycast-mod@claude-mod-lab', version: '0.1.0', scope: 'local', enabled: false, projectPath: '/elsewhere' },
  { id: 'mod-lab@claude-mod-lab', version: '0.1.0', scope: 'local', enabled: true, projectPath: '/work' },
])

test('installedCopies answers the enabled installed copies of the names asked about, asking in the folder given; a .claude/skills/ copy is none', async () => {
  const asked = []
  const list = async cwd => {
    asked.push(cwd)
    return LISTED
  }
  const found = await installedCopies(['brackets-mod', 'keycast-mod', 'mod-lab-target'], { cwd: '/work', list })
  assert.deepEqual(asked, ['/work'])
  assert.deepEqual(found, {
    copies: [{ id: 'brackets-mod@claude-mod-lab', name: 'brackets-mod', scope: 'user' }],
    problem: null,
  })
  const lab = await installedCopies(['mod-lab'], { cwd: '/work', list })
  assert.deepEqual(
    lab.copies.map(copy => copy.id),
    ['mod-lab@claude-mod-lab'],
  )
})

test('installedCopies answers no copies and the reason when claude cannot be asked', async () => {
  const failed = await installedCopies(['brackets-mod'], {
    cwd: '/work',
    list: async () => {
      throw new Error('spawn claude ENOENT')
    },
  })
  assert.deepEqual(failed.copies, [])
  assert.match(failed.problem, /spawn claude ENOENT/)
  const garbled = await installedCopies(['brackets-mod'], { cwd: '/work', list: async () => 'not json' })
  assert.deepEqual(garbled.copies, [])
  assert.ok(garbled.problem !== null)
  const odd = await installedCopies(['brackets-mod'], { cwd: '/work', list: async () => '{"installed": []}' })
  assert.deepEqual(odd.copies, [])
  assert.match(odd.problem, /unexpected response/)
})

test('project plugin suppression remains visible even though the suppression entry is disabled', async () => {
  const note =
    '2 project-scope directories under ./.claude/skills/ were skipped because this workspace was not trusted.'
  const found = await installedCopies(['gallery-mod'], {
    cwd: '/work',
    list: async () =>
      JSON.stringify([
        {
          id: '(suppressed)@skills-dir',
          enabled: false,
          scope: 'project',
          notes: [note],
          noteDetails: [{ type: 'project-scope-suppressed-untrusted' }],
        },
      ]),
  })
  assert.deepEqual(found, { copies: [], problem: note })
  const unnamed = await installedCopies([], {
    cwd: '/work',
    list: async () => JSON.stringify([{ id: '(suppressed)@skills-dir', notes: null }]),
  })
  assert.match(unnamed.problem, /skipped project plugins/)
})

test('sideloadRefusal answers Claude Code refusing --plugin-dir under managed settings, and null for any other answer', async () => {
  const refused = Object.assign(new Error('Command failed'), {
    stderr: "--plugin-dir is disabled by your organization's managed settings (disableSideloadFlags).\n",
  })
  const refusing = async () => {
    throw refused
  }
  assert.match(await sideloadRefusal('/work/workshop', { cwd: '/work', list: refusing }), /disableSideloadFlags/)
  assert.equal(await sideloadRefusal('/work/workshop', { cwd: '/work', list: async () => '[]' }), null)
  const missing = async () => {
    throw new Error('spawn claude ENOENT')
  }
  assert.equal(await sideloadRefusal('/work/workshop', { cwd: '/work', list: missing }), null)
})

test('the notes name the installed copy, and the skills note the command that disables it for this folder', () => {
  const copy = { id: 'brackets-mod@claude-mod-lab', name: 'brackets-mod', scope: 'user' }
  const skills = skillsCopyNote(copy)
  assert.match(skills, /brackets-mod@claude-mod-lab, user scope/)
  assert.match(skills, /claude plugin disable brackets-mod@claude-mod-lab --scope local/)
  assert.match(sessionCopyNote(copy), /takes precedence, with a store of its own/)
})
