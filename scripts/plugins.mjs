// The repository's plugins, read from .claude-plugin/marketplace.json, plus
// scratch-mod, which the marketplace leaves out because it comes as a copy to
// edit. With an action it runs claude over them:
//
//   node scripts/plugins.mjs validate   the marketplace file, then each plugin (npm run validate)
//   node scripts/plugins.mjs test       `claude plugin test` on each mod, the plugins with a
//                                       hooks module (npm run test:mods); mod-bootstrap, a skill,
//                                       has tests of its own (npm run test:plugins)
//
// Folders after the action take the place of the list: node scripts/plugins.mjs test mods/scratch-mod.
// Each plugin runs in turn; the run goes on past a failure and exits 1 at the end, naming them.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Plugins kept out of the marketplace, with the folder each is in. */
const UNLISTED = [{ name: 'scratch-mod', source: './mods/scratch-mod' }]

/**
 * Every plugin, as its name and its folder relative to the repository, in the
 * marketplace's order with the unlisted ones last.
 *
 * @param {string} [repo]
 * @returns {{ name: string, dir: string }[]}
 */
export function plugins(repo = REPO) {
  const { plugins: listed } = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'))
  return [...listed, ...UNLISTED].map(({ name, source }) => ({ name, dir: relative(repo, join(repo, source)) }))
}

/** A mod: a plugin with a hooks module, which `claude plugin test` runs the tests of. */
export const isMod = dir => existsSync(join(dir, 'hooks', 'hooks.json'))

function validate(dirs) {
  const failed = []
  for (const dir of ['.', ...dirs]) {
    const result = spawnSync('claude', ['plugin', 'validate', dir], { cwd: REPO, encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status === 0) console.log(`ok   ${dir}`)
    else {
      console.log(`FAIL ${dir}\n${result.stdout}${result.stderr}`)
      failed.push(dir)
    }
  }
  return failed
}

function test(dirs) {
  const failed = []
  for (const dir of dirs.filter(one => isMod(join(REPO, one)))) {
    console.log(`== ${dir}`)
    const result = spawnSync('claude', ['plugin', 'test', dir], { cwd: REPO, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) failed.push(dir)
  }
  return failed
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const [action, ...given] = process.argv.slice(2)
  const actions = { validate, test }
  if (!(action in actions)) {
    console.error('Usage: node scripts/plugins.mjs validate|test [folder...]')
    process.exit(2)
  }
  const dirs = given.length > 0 ? given.map(dir => relative(REPO, resolve(dir))) : plugins().map(one => one.dir)
  const failed = actions[action](dirs)
  if (failed.length > 0) {
    console.error(`\n${action} failed for ${failed.length}: ${failed.join(', ')}`)
    process.exit(1)
  }
}
