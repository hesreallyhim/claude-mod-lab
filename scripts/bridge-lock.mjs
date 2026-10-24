// `npm run bridge-lock [-- --no-commit]`, after `npm publish` of a release
// (CONTRIBUTING.md, Releasing). It writes mods/mod-lab-bridge/package-lock.json
// for the claude-mod-lab version just published, so that Claude Code's install
// of the plugin brings the package whose explorer the bridge serves
// (scripts/bridge-deps.mjs). In order, it:
//
// 1. reads the package's version, and refuses unless the bridge's package.json
//    names the same one (npm run release sets it) and npm has it published;
// 2. writes the lockfile with `npm install --package-lock-only --ignore-scripts`
//    in the bridge's folder, which resolves against the registry and installs nothing;
// 3. checks that the lockfile pins claude-mod-lab at that version with the
//    integrity npm gives for it, and that nothing in it has an install script;
// 4. commits the bridge's package.json and lockfile alone, and tags the bridge
//    with `claude plugin tag`, which `npm run release` left for this step.
//
// --no-commit stops after step 3.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BRIDGE_DIR, bridgeDependency, bridgeLocked, PACKAGE, REPO } from './bridge-deps.mjs'

function run(file, args, cwd = REPO) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

function must(what, file, args, cwd) {
  const result = run(file, args, cwd)
  if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout.trim()
}

function main(args) {
  const unknown = args.filter(arg => arg !== '--no-commit')
  if (unknown.length > 0) {
    console.error('Usage: npm run bridge-lock [-- --no-commit]')
    return 2
  }
  const { version } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const named = bridgeDependency()
  if (named !== version) {
    console.error(`${BRIDGE_DIR}/package.json names ${PACKAGE} ${named}, the package is at ${version}: run npm run release first`)
    return 1
  }
  const viewed = run('npm', ['view', `${PACKAGE}@${version}`, 'dist.integrity', '--json'])
  const integrity = viewed.status === 0 && viewed.stdout.trim() !== '' ? JSON.parse(viewed.stdout) : null
  if (typeof integrity !== 'string') {
    console.error(`npm has no ${PACKAGE}@${version} yet: publish the tarball npm run pack-check printed, then run this again`)
    return 1
  }

  const bridge = join(REPO, BRIDGE_DIR)
  must('npm install --package-lock-only', 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], bridge)
  const locked = bridgeLocked()
  const problems = []
  if (locked?.version !== version) problems.push(`the lockfile pins ${PACKAGE} ${locked?.version ?? 'nothing'}, not ${version}`)
  else if (locked.integrity !== integrity) problems.push(`the lockfile's integrity for ${PACKAGE}@${version} is not the one npm gives (${integrity})`)
  const lock = JSON.parse(readFileSync(join(bridge, 'package-lock.json'), 'utf8'))
  const scripted = Object.entries(lock.packages ?? {}).filter(([, entry]) => entry.hasInstallScript).map(([path]) => path)
  if (scripted.length > 0) problems.push(`these have install scripts: ${scripted.join(', ')}`)
  for (const problem of problems) console.error(`bridge-lock refuses: ${problem}`)
  if (problems.length > 0) return 1
  console.log(`${BRIDGE_DIR}/package-lock.json pins ${PACKAGE}@${version} (${integrity})`)
  if (args.includes('--no-commit')) return 0

  const paths = [join(BRIDGE_DIR, 'package.json'), join(BRIDGE_DIR, 'package-lock.json')]
  must('git add', 'git', ['add', '--', ...paths])
  if (run('git', ['diff', '--cached', '--quiet', '--', ...paths]).status !== 0) {
    must('git commit', 'git', ['commit', '--quiet', '--message', `chore(release): lock mod-lab-bridge to ${PACKAGE}@${version}`, '--', ...paths])
    console.log(`committed ${must('git rev-parse', 'git', ['rev-parse', '--short', 'HEAD'])}`)
  } else console.log('the lockfile was already committed')
  const tag = `mod-lab-bridge--v${version}`
  if (run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0) {
    console.log(`${tag} is already there`)
  } else {
    must('claude plugin tag', 'claude', ['plugin', 'tag', BRIDGE_DIR, '--message', 'mod-lab-bridge %s'])
    console.log(`tagged, locally: ${tag}`)
  }
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(`bridge-lock: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
