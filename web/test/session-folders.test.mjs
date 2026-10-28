import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { labFolders, labPlugins, packageFacts, refreshCopy, sessionFolders } from '../lib/session-folders.mjs'

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'session-folders-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A plugin folder with a manifest (more fields merged in) and one hooks file. */
function plugin(dir, name, manifest = {}) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, ...manifest }))
  writeFileSync(join(dir, 'hooks', 'hooks.json'), '{}')
  return dir
}

/** A package root with the lab's three mods, the authoring skill, gallery-mod and one template. */
function packageIn(dir, labManifest = {}) {
  const root = join(dir, 'package')
  plugin(join(root, 'mods', 'mod-lab'), 'mod-lab', labManifest)
  plugin(join(root, 'mods', 'mod-lab-bridge'), 'mod-lab-bridge', { dependencies: ['mod-lab'] })
  plugin(join(root, 'mods', 'mod-lab-target'), 'mod-lab-target')
  plugin(join(root, 'mods', 'gallery-mod'), 'gallery-mod')
  plugin(join(root, 'templates', 'band-mod'), 'band-mod')
  const name = 'mod-bootstrap'
  const folder = join(root, 'plugins', name)
  mkdirSync(join(folder, '.claude-plugin'), { recursive: true })
  mkdirSync(join(folder, 'skills', name), { recursive: true })
  writeFileSync(join(folder, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
  writeFileSync(
    join(folder, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill\n---\nInstructions\n`,
  )
  return root
}

test('the lab loads as mod-lab, mod-lab-bridge, mod-lab-target, then the other dependencies mod-lab names', () =>
  inTemp(dir => {
    const bare = packageIn(join(dir, 'before'))
    assert.deepEqual(labPlugins(join(bare, 'mods')), {
      names: ['mod-lab', 'mod-lab-bridge', 'mod-lab-target'],
      missing: [],
    })
    // mod-lab depends on mod-lab-keys and mod-lab-target.
    const keyed = packageIn(join(dir, 'after'), { dependencies: ['mod-lab-keys', 'mod-lab-target'] })
    assert.deepEqual(labPlugins(join(keyed, 'mods')).missing, ['mod-lab-keys'])
    plugin(join(keyed, 'mods', 'mod-lab-keys'), 'mod-lab-keys')
    assert.deepEqual(labPlugins(join(keyed, 'mods')), {
      names: ['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-lab-keys'],
      missing: [],
    })
  }))

test("a session loads the lab's folders in place from a git checkout, then the workspace's workshop/", () =>
  inTemp(dir => {
    const root = packageIn(dir)
    const workspace = join(dir, 'work')
    const loaded = sessionFolders({
      packageRoot: root,
      home: join(dir, 'home'),
      version: '1.2.3',
      inPlace: true,
      workspace,
    })
    assert.deepEqual(loaded.folders, [
      join(root, 'mods', 'mod-lab'),
      join(root, 'mods', 'mod-lab-bridge'),
      join(root, 'mods', 'mod-lab-target'),
      join(root, 'plugins', 'mod-bootstrap'),
      join(workspace, 'workshop'),
    ])
    assert.deepEqual(loaded.names, ['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-bootstrap'])
    assert.deepEqual(loaded.missing, [])
    assert.equal(loaded.copyRoot, null)
    assert.ok(!existsSync(join(dir, 'home')), 'nothing is copied')
  }))

test('from an npm install the package folders load from copies under ~/.claude-mod-lab/plugins/<version>/', () =>
  inTemp(dir => {
    const root = packageIn(dir)
    const home = join(dir, 'home')
    const workspace = join(dir, 'work')
    const loaded = sessionFolders({ packageRoot: root, home, version: '1.2.3', inPlace: false, workspace })
    const copies = join(home, '.claude-mod-lab', 'plugins', '1.2.3')
    assert.equal(loaded.copyRoot, copies)
    assert.deepEqual(loaded.folders, [
      join(copies, 'mod-lab'),
      join(copies, 'mod-lab-bridge'),
      join(copies, 'mod-lab-target'),
      join(copies, 'mod-bootstrap'),
      join(workspace, 'workshop'),
    ])
    assert.ok(existsSync(join(copies, 'mod-lab-bridge', '.claude-plugin', 'plugin.json')))
    const name = 'mod-bootstrap'
    assert.equal(
      readFileSync(join(copies, name, 'skills', name, 'SKILL.md'), 'utf8'),
      readFileSync(join(root, 'plugins', name, 'skills', name, 'SKILL.md'), 'utf8'),
    )
    assert.ok(!existsSync(join(copies, name, 'hooks')), 'skill plugins do not need hooks')
    assert.ok(!existsSync(join(copies, 'gallery-mod')), 'only the lab is copied')
    assert.deepEqual(
      labFolders({ packageRoot: root, home, version: '1.2.3', inPlace: false }),
      loaded.folders.slice(0, 3),
    )
  }))

test('a project session loads the lab and authoring skills without a lesson workspace', () =>
  inTemp(dir => {
    const root = packageIn(dir)
    const loaded = sessionFolders({ packageRoot: root, home: join(dir, 'home'), version: '1.2.3', inPlace: true })
    assert.deepEqual(loaded.folders, [
      ...labFolders({ packageRoot: root, home: join(dir, 'home'), version: '1.2.3', inPlace: true }),
      join(root, 'plugins', 'mod-bootstrap'),
    ])
    assert.ok(!existsSync(join(dir, 'home')))
  }))

test('a missing bundled skill is reported without loading a stale cached copy', () =>
  inTemp(dir => {
    const root = packageIn(dir)
    const home = join(dir, 'home')
    const options = { packageRoot: root, home, version: '1.2.3', inPlace: false }
    sessionFolders(options)
    rmSync(join(root, 'plugins', 'mod-bootstrap'), { recursive: true })
    const loaded = sessionFolders(options)
    assert.deepEqual(loaded.missing, ['mod-bootstrap'])
    assert.ok(!loaded.names.includes('mod-bootstrap'))
    assert.ok(!loaded.folders.includes(join(home, '.claude-mod-lab', 'plugins', '1.2.3', 'mod-bootstrap')))
  }))

test('refreshCopy brings a copy in line with the package and keeps the files the engine wrote', () =>
  inTemp(dir => {
    const from = plugin(join(dir, 'from'), 'mod-lab')
    writeFileSync(join(from, 'hooks', 'register.ts'), 'export default 1\n')
    const to = join(dir, 'to')
    refreshCopy(from, to)
    assert.equal(readFileSync(join(to, 'hooks', 'register.ts'), 'utf8'), 'export default 1\n')
    // The engine lays its declarations and a tsconfig; a file the package dropped lingers.
    mkdirSync(join(to, '.claude-plugin', 'types', 'claude-code'), { recursive: true })
    writeFileSync(join(to, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'), '// laid')
    writeFileSync(join(to, 'tsconfig.json'), '{}')
    writeFileSync(join(to, 'hooks', 'old.ts'), '')
    const unchanged = statSync(join(to, 'hooks', 'hooks.json')).mtimeMs
    writeFileSync(join(from, 'hooks', 'register.ts'), 'export default 2\n')
    refreshCopy(from, to)
    assert.equal(readFileSync(join(to, 'hooks', 'register.ts'), 'utf8'), 'export default 2\n')
    assert.ok(!existsSync(join(to, 'hooks', 'old.ts')))
    assert.ok(existsSync(join(to, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')))
    assert.ok(existsSync(join(to, 'tsconfig.json')))
    assert.equal(statSync(join(to, 'hooks', 'hooks.json')).mtimeMs, unchanged, 'a file already the same is not written')
  }))

test('packageFacts reads the version, and loads in place where the package is a git checkout', () =>
  inTemp(dir => {
    const root = packageIn(dir)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'claude-mod-lab', version: '4.5.6' }))
    assert.deepEqual(packageFacts(root), { version: '4.5.6', inPlace: false })
    writeFileSync(join(root, '.git'), 'gitdir: elsewhere\n')
    assert.deepEqual(packageFacts(root), { version: '4.5.6', inPlace: true })
    const home = join(dir, 'home')
    assert.deepEqual(labFolders({ packageRoot: root, home, version: '4.5.6', inPlace: true }), [
      join(root, 'mods', 'mod-lab'),
      join(root, 'mods', 'mod-lab-bridge'),
      join(root, 'mods', 'mod-lab-target'),
    ])
    assert.ok(!existsSync(home), 'labFolders writes nothing')
  }))
