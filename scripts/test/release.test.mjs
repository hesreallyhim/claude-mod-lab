// Exercise releases in a disposable Git repository. npm packaging and Claude
// tagging are stand-ins; no registry, user configuration or real tags are used.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('..', import.meta.url))
const CORE = ['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-lab-keys']
const LISTED = [...CORE, 'gallery-mod']
const LESSONS = ['learn/tutorials/tick/starter', 'learn/tutorials/tick/solution']
const ALL_DIRS = [...LISTED, 'scratch-mod'].map(name => `mods/${name}`).concat(LESSONS)
const json = file => JSON.parse(readFileSync(file, 'utf8'))

function fixture(t, { lessonVersion = '0.0.5' } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'mod-lab-release-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const repo = join(temp, 'repo')
  const tools = join(temp, 'tools')
  mkdirSync(repo)
  symlinkSync(join(SOURCE, '..', 'node_modules'), join(repo, 'node_modules'), 'dir')
  mkdirSync(tools)
  const write = (file, value) => {
    const dest = join(repo, file)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
  }
  write('.gitignore', 'node_modules/\n')
  mkdirSync(join(repo, 'scripts'))
  for (const file of ['release.mjs', 'bridge-deps.mjs', 'plugins.mjs']) copyFileSync(join(SOURCE, file), join(repo, 'scripts', file))
  write('package.json', { name: 'claude-mod-lab', version: '0.1.0', private: true })
  write('package-lock.json', { name: 'claude-mod-lab', version: '0.1.0', lockfileVersion: 3, packages: { '': { version: '0.1.0' } } })
  write('.claude-plugin/marketplace.json', { plugins: LISTED.map(name => ({ name, source: `./mods/${name}` })) })
  for (const name of [...LISTED, 'scratch-mod']) write(`mods/${name}/.claude-plugin/plugin.json`, { name, version: '0.1.0' })
  // Same plugin name in two independently versioned lesson copies.
  write(`${LESSONS[0]}/.claude-plugin/plugin.json`, { name: 'tick', version: lessonVersion })
  write(`${LESSONS[1]}/.claude-plugin/plugin.json`, { name: 'tick', version: '0.1.0' })
  write('mods/mod-lab-bridge/package.json', { dependencies: { 'claude-mod-lab': '0.1.0' } })
  write('mods/mod-lab-bridge/package-lock.json', { packages: { 'node_modules/claude-mod-lab': { version: '0.1.0', integrity: 'old' } } })
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '--quiet')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  git('add', '.')
  git('commit', '--quiet', '-m', 'initial fixture')
  writeFileSync(join(tools, 'stand-in.cjs'), `
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const [tool, ...args] = process.argv.slice(2)
if (tool === 'npm') {
  if (args[0] === 'version') {
    for (const file of ['package.json', 'package-lock.json']) {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      value.version = args[1]
      if (value.packages) value.packages[''].version = args[1]
      fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n')
    }
  } else if (args.join(' ') !== 'run pack-check') process.exit(2)
} else if (args[0] === 'plugin' && args[1] === 'tag') {
  const manifest = JSON.parse(fs.readFileSync(args[2] + '/.claude-plugin/plugin.json', 'utf8'))
  process.exit(spawnSync('git', ['tag', manifest.name + '--v' + manifest.version]).status)
} else process.exit(2)
`)
  for (const tool of ['npm', 'claude']) {
    const executable = join(tools, tool)
    writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${tools}/stand-in.cjs" ${tool} "$@"\n`)
    chmodSync(executable, 0o755)
  }
  const release = (...args) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
  })
  const manifest = dir => json(join(repo, dir, '.claude-plugin/plugin.json'))
  return { repo, git, write, release, manifest }
}

test('--all-plugins dry-run includes lesson copies without writes or lesson tags', t => {
  const { git, release } = fixture(t)
  const before = git('rev-parse', 'HEAD')
  const result = release('0.2.0', '--all-plugins', '--dry-run')
  assert.equal(result.status, 0, result.stderr)
  for (const dir of ALL_DIRS) assert.ok(result.stdout.includes(`(${dir})`), dir)
  const tagLine = result.stdout.split('\n').find(line => line.startsWith('would tag:'))
  assert.ok(tagLine.includes('gallery-mod--v0.2.0'))
  assert.ok(!tagLine.includes('tick--v'))
  assert.ok(!tagLine.includes('mod-lab-bridge--v'))
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(git('rev-parse', 'HEAD'), before)
  assert.equal(git('tag', '--list'), '')
})

test('--all-plugins bumps every manifest and bridge dependency once, with only release-plugin tags', t => {
  const { repo, git, release, manifest } = fixture(t)
  const first = release('0.2.0', '--all-plugins')
  assert.equal(first.status, 0, first.stdout + first.stderr)
  for (const dir of ALL_DIRS) assert.equal(manifest(dir).version, '0.2.0', dir)
  assert.equal(json(join(repo, 'package.json')).version, '0.2.0')
  assert.equal(json(join(repo, 'package-lock.json')).packages[''].version, '0.2.0')
  assert.equal(json(join(repo, 'mods/mod-lab-bridge/package.json')).dependencies['claude-mod-lab'], '0.2.0')
  assert.equal(existsSync(join(repo, 'mods/mod-lab-bridge/package-lock.json')), false)
  const tags = [...CORE.filter(name => name !== 'mod-lab-bridge'), 'gallery-mod', 'scratch-mod'].map(name => `${name}--v0.2.0`).sort()
  assert.deepEqual(git('tag', '--list').split('\n'), tags)
  const commit = git('rev-parse', 'HEAD')
  const repeat = release('0.2.0', '--all-plugins')
  assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr)
  assert.equal(git('rev-parse', 'HEAD'), commit)
  assert.equal(git('status', '--porcelain'), '')
  assert.deepEqual(git('tag', '--list').split('\n'), tags)
})

test('--all-plugins refuses to lower even an unlisted lesson version before writing', t => {
  const { repo, git, release, manifest } = fixture(t, { lessonVersion: '0.3.0' })
  const result = release('0.2.0', '--all-plugins')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /0\.3\.0, above 0\.2\.0/)
  assert.equal(json(join(repo, 'package.json')).version, '0.1.0')
  assert.equal(manifest(LESSONS[0]).version, '0.3.0')
  assert.equal(git('status', '--porcelain'), '')
  assert.equal(git('tag', '--list'), '')
})

test('without --all-plugins, independent plugins retain patch-release behavior and lessons are untouched', t => {
  const { git, release, manifest, write } = fixture(t)
  git('tag', 'gallery-mod--v0.1.0')
  write('mods/gallery-mod/README.md', 'Changed since its last release.\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'change gallery')
  const result = release('0.2.0')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const name of CORE) assert.equal(manifest(`mods/${name}`).version, '0.2.0')
  assert.equal(manifest('mods/gallery-mod').version, '0.1.1')
  assert.equal(manifest('mods/scratch-mod').version, '0.1.0')
  assert.equal(manifest(LESSONS[0]).version, '0.0.5')
  assert.equal(manifest(LESSONS[1]).version, '0.1.0')
})

test('prereleases advance numerically, repeat safely, and promote to stable without allowing downgrades', t => {
  const { repo, git, release, manifest } = fixture(t)
  for (const version of ['0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.10']) {
    const result = release(version, '--all-plugins')
    assert.equal(result.status, 0, result.stdout + result.stderr)
    for (const dir of ALL_DIRS) assert.equal(manifest(dir).version, version, dir)
    assert.equal(json(join(repo, 'mods/mod-lab-bridge/package.json')).dependencies['claude-mod-lab'], version)
  }
  const beforeRepeat = git('rev-parse', 'HEAD')
  const repeat = release('0.2.0-beta.10', '--all-plugins')
  assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr)
  assert.equal(git('rev-parse', 'HEAD'), beforeRepeat)
  const olderBeta = release('0.2.0-beta.2', '--all-plugins')
  assert.equal(olderBeta.status, 1)
  assert.match(olderBeta.stderr, /0\.2\.0-beta\.10, above 0\.2\.0-beta\.2/)
  assert.equal(git('status', '--porcelain'), '')
  const stable = release('0.2.0', '--all-plugins')
  assert.equal(stable.status, 0, stable.stdout + stable.stderr)
  const backToBeta = release('0.2.0-beta.11', '--all-plugins')
  assert.equal(backToBeta.status, 1)
  assert.match(backToBeta.stderr, /0\.2\.0, above 0\.2\.0-beta\.11/)
  assert.equal(git('status', '--porcelain'), '')
})

test('independent prerelease plugins patch to stable using their newest prerelease tag', t => {
  const { git, release, manifest, write } = fixture(t)
  const first = release('0.2.0-beta.10', '--all-plugins')
  assert.equal(first.status, 0, first.stdout + first.stderr)
  // This older tag sorts after beta.10 lexically, but must not be selected.
  git('tag', 'gallery-mod--v0.2.0-beta.2')
  write('mods/gallery-mod/README.md', 'Changed since beta.10.\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'change prerelease gallery')
  const result = release('0.2.0-beta.11')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /changed since gallery-mod--v0\.2\.0-beta\.10/)
  assert.equal(manifest('mods/gallery-mod').version, '0.2.0')
  assert.ok(git('tag', '--list').includes('gallery-mod--v0.2.0'))
})

test('invalid and noncanonical versions fail before changing the fixture', t => {
  const { git, release } = fixture(t)
  for (const version of ['0.2', '0.02.0', '0.2.0-beta.01', '0.2.0-beta..1', 'v0.2.0']) {
    const result = release(version, '--all-plugins')
    assert.equal(result.status, 2, version)
    assert.match(result.stderr, /Usage:/)
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(git('tag', '--list'), '')
  }
})
