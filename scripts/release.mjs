// `npm run release -- <version> [--all-plugins] [--dry-run]`, on the maintainer's machine, from
// a clean working tree (CONTRIBUTING.md, Releasing, step 1). In order, it:
//
// 1. bumps the coupled parts to <version> together: the package (package.json
//    and package-lock.json), mod-lab, mod-lab-bridge, mod-lab-target and
//    mod-lab-keys, which the bridge protocol ties,
//    and the claude-mod-lab version mod-lab-bridge's own package.json names
//    (scripts/bridge-deps.mjs), dropping its lockfile for the old version;
// 2. gives any other plugin that changed since its last release a patch bump,
//    unless its version already rose;
// 3. runs the version guard, below;
// 4. commits the bump as "chore(release): v<version>";
// 5. runs `npm run pack-check`, which packs that commit;
// 6. tags each plugin whose version has no tag yet, with `claude plugin tag`
//    ({name}--v{version}), on that commit; all but mod-lab-bridge, which
//    `npm run bridge-lock` tags once its lockfile names the published package.
//
// A plugin's last release is its newest {name}--v<version> tag, including prereleases. The guard
// refuses: a plugin changed since that tag whose version did not rise, which
// `claude plugin update` would not offer; a version below its tag's; a
// coupled part out of step with the package, the bridge's dependency
// included; and a version in a marketplace entry, since versions live in
// plugin.json alone.
//
// --dry-run says what would be bumped and tagged, and writes nothing. The tags
// stay local: the maintainer publishes the tarball pack-check printed, runs
// `npm run bridge-lock`, then pushes the tags with the signed release tag. Run
// again with the same version after fixing a failed step; nothing already
// bumped is bumped twice. --all-plugins sets every tracked plugin manifest to
// <version>, including lesson starters and solutions; those lesson copies are
// not marketplace releases and do not receive plugin tags.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, inc, valid } from 'semver'

import { BRIDGE_DIR, bridgeDependency, setBridgeDependency } from './bridge-deps.mjs'
import { plugins } from './plugins.mjs'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const COUPLED = ['mod-lab', 'mod-lab-bridge', 'mod-lab-target', 'mod-lab-keys']
const isVersion = version => valid(version) === version

function run(file, args, { quiet = false } = {}) {
  const result = spawnSync(file, args, { cwd: REPO, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })
  if (result.error) throw result.error
  return result
}

/** Runs a step the release cannot go on without; throws when it fails. */
function must(what, file, args, options) {
  const result = run(file, args, options)
  if (result.status !== 0) throw new Error(`${what} failed${options?.quiet ? `:\n${result.stdout}${result.stderr}` : ''}`)
  return result.stdout ?? ''
}

const git = (...args) => must(`git ${args[0]}`, 'git', args, { quiet: true }).trim()

const patch = version => inc(version, 'patch')

const manifestPath = dir => join(REPO, dir, '.claude-plugin', 'plugin.json')
const versionOf = dir => JSON.parse(readFileSync(manifestPath(dir), 'utf8')).version

/** Sets a manifest's version in place, so the rest of the file keeps its layout. */
function setVersion(dir, version) {
  const text = readFileSync(manifestPath(dir), 'utf8')
  if (!/"version"\s*:\s*"[^"]*"/.test(text)) throw new Error(`${dir}/.claude-plugin/plugin.json has no version to bump`)
  writeFileSync(manifestPath(dir), text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`))
}

/** The plugin's newest release tag and its version, or null before its first release. */
function lastRelease(name) {
  const prefix = `${name}--v`
  const versions = git('tag', '--list', `${prefix}*`)
    .split('\n')
    .map(tag => tag.slice(prefix.length))
    .filter(isVersion)
    .sort(compare)
  const version = versions.at(-1)
  return version === undefined ? null : { tag: `${prefix}${version}`, version }
}

/** Whether the folder differs, in the working tree, from what the tag holds. */
const changedSince = (tag, dir) => run('git', ['diff', '--quiet', tag, '--', dir], { quiet: true }).status !== 0

/** Release plugins, optionally including every other tracked plugin manifest. */
function readPlugins(allPlugins = false) {
  const listed = plugins(REPO).map(({ name, dir }) => ({ name, dir, version: versionOf(dir), last: lastRelease(name), taggable: true }))
  if (!allPlugins) return listed
  const known = new Set(listed.map(one => one.dir))
  const suffix = '/.claude-plugin/plugin.json'
  const extra = git('ls-files', '-z').split('\0').filter(file => file.endsWith(suffix))
    .map(file => file.slice(0, -suffix.length)).filter(dir => !known.has(dir))
    .map(dir => {
      const { name, version } = JSON.parse(readFileSync(manifestPath(dir), 'utf8'))
      return { name, dir, version, last: null, taggable: false }
    })
  return [...listed, ...extra]
}

/** The bumps a release to `version` makes: the coupled parts to it, any other changed plugin a patch up. */
function plan(version, list, allPlugins = false) {
  const bumps = []
  for (const plugin of list) {
    if (allPlugins || COUPLED.includes(plugin.name)) {
      if (compare(version, plugin.version) < 0) throw new Error(`${plugin.name} is at ${plugin.version}, above ${version}`)
      if (plugin.version !== version) bumps.push({ ...plugin, to: version })
    } else if (plugin.last !== null && changedSince(plugin.last.tag, plugin.dir)) {
      if (compare(plugin.version, plugin.last.version) <= 0) bumps.push({ ...plugin, to: patch(plugin.last.version) })
    }
  }
  return bumps
}

/**
 * What the version guard refuses, as sentences; empty when the release may go ahead. `bridge` is the
 * claude-mod-lab version mod-lab-bridge's package.json names: as planned before anything is written.
 */
function guard(packageVersion, list, bridge = bridgeDependency(), allPlugins = false) {
  const problems = []
  if (bridge !== packageVersion) {
    problems.push(`${BRIDGE_DIR}/package.json names claude-mod-lab ${bridge}, the package is at ${packageVersion}: the coupled parts move together`)
  }
  for (const { name, dir, version, last } of list) {
    if ((allPlugins || COUPLED.includes(name)) && version !== packageVersion) {
      problems.push(`${name} is at ${version}, the package at ${packageVersion}: the coupled parts move together`)
    }
    if (last === null) continue
    if (compare(version, last.version) < 0) problems.push(`${name} is at ${version}, below its release ${last.tag}`)
    else if (compare(version, last.version) === 0 && changedSince(last.tag, dir)) {
      problems.push(`${name} changed since ${last.tag} and is still at ${version}: claude plugin update would not offer it`)
    }
  }
  const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'))
  for (const entry of marketplace.plugins) {
    if ('version' in entry) problems.push(`the marketplace entry for ${entry.name} has a version: it belongs in plugin.json alone`)
  }
  return problems
}

/** Explains a planned bump without assuming that a lesson copy has a release tag. */
function bumpReason(bump, allPlugins) {
  if (allPlugins) return ` (${bump.dir})`
  if (COUPLED.includes(bump.name)) return ''
  return ` (changed since ${bump.last.tag})`
}

function printPlan(version, previousVersion, bumps, allPlugins) {
  console.log(`== release ${version}`)
  console.log(`   package  ${previousVersion} -> ${version}`)
  for (const bump of bumps) console.log(`   ${bump.name}  ${bump.version} -> ${bump.to}${bumpReason(bump, allPlugins)}`)
}

function printDryRun(list) {
  const untagged = list
    .filter(one => one.taggable && one.last?.version !== one.version && one.name !== 'mod-lab-bridge')
    .map(one => `${one.name}--v${one.version}`)
  console.log(`\nwould tag: ${untagged.join(', ') || 'nothing'}; mod-lab-bridge is tagged by npm run bridge-lock`)
  console.log('\n--dry-run: nothing was written')
}

function main(args) {
  const isDry = args.includes('--dry-run')
  const allPlugins = args.includes('--all-plugins')
  const [version, ...extra] = args.filter(arg => arg !== '--dry-run' && arg !== '--all-plugins')
  if (version === undefined || extra.length > 0 || !isVersion(version)) {
    console.error('Usage: npm run release -- <version, e.g. 0.2.0-beta.1> [--all-plugins] [--dry-run]')
    return 2
  }
  if (!isDry && git('status', '--porcelain', '--untracked-files=no') !== '') {
    console.error('The working tree has uncommitted changes: commit or stash them first, so the release commit holds the bump alone.')
    return 1
  }
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  if (compare(version, pkg.version) < 0) throw new Error(`the package is at ${pkg.version}, above ${version}`)
  const bumps = plan(version, readPlugins(allPlugins), allPlugins)
  printPlan(version, pkg.version, bumps, allPlugins)
  // The guard runs on the versions planned, before anything is written, and again once they are.
  const after = readPlugins(allPlugins).map(one => ({ ...one, version: bumps.find(bump => bump.dir === one.dir)?.to ?? one.version }))
  const refused = guard(version, after, version, allPlugins)
  for (const problem of refused) console.error(`the version guard refuses: ${problem}`)
  if (isDry) {
    printDryRun(after)
    return refused.length > 0 ? 1 : 0
  }
  if (refused.length > 0) return 1

  must('npm version', 'npm', ['version', version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'], {
    quiet: true,
  })
  for (const bump of bumps) setVersion(bump.dir, bump.to)
  setBridgeDependency(version)
  const problems = guard(version, readPlugins(allPlugins), bridgeDependency(), allPlugins)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`the version guard refuses: ${problem}`)
    console.error('Nothing is committed; git restore . puts the bumped files back.')
    return 1
  }
  console.log('\nthe version guard: ok')

  if (git('status', '--porcelain', '--untracked-files=no') !== '') {
    git('commit', '--all', '--quiet', '--message', `chore(release): v${version}\n\n${bumps.map(bump => `${bump.name} ${bump.to}`).join('\n') || 'the package alone'}`)
    console.log(`committed ${git('rev-parse', '--short', 'HEAD')}: chore(release): v${version}`)
  } else console.log('nothing to commit: every version was already bumped')

  console.log('\n== npm run pack-check')
  must('npm run pack-check', 'npm', ['run', 'pack-check'])

  console.log('\n== tags')
  const tags = []
  for (const { name, dir, version: at, last } of readPlugins()) {
    // The bridge's tag waits for its lockfile, which names the package once it is on npm.
    if (last?.version === at || name === 'mod-lab-bridge') continue
    must(`claude plugin tag ${dir}`, 'claude', ['plugin', 'tag', dir, '--message', `${name} %s`], { quiet: true })
    tags.push(`${name}--v${at}`)
  }
  console.log(tags.length > 0 ? `tagged, locally: ${tags.join(' ')}` : 'every plugin version was already tagged')
  console.log(
    `\nNext, as G has it: npm publish the tarball pack-check printed above, then npm run bridge-lock, ` +
      `which locks and tags mod-lab-bridge; then merge into main, sign the release tag v${version} and push it with these tags.`,
  )
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(`release: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
