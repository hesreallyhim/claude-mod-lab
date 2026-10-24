// Removes everything git ignores in the checkout except INTERNAL/ (and
// __INTERNAL__/) folders, the coverage report and antipasta's reports:
// node_modules, the declarations and tsconfig.json a session lays beside each
// plugin it loads from a folder, the workshop's mods and progress, .claude/,
// and the rest. It asks git which entries are ignored, so a tracked file is
// never touched. node_modules and the git hooks come back with npm install.
// `npm run clean` removes; `npm run clean -- --dry-run` lists what it would.

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Kept: private notes wherever they sit, the last coverage report, and antipasta's reports. */
const KEPT = /(^|\/)(INTERNAL|__INTERNAL__)\/|^coverage\/|(^|\/)antipasta[^/]*\/?$/

/** The ignored files and folders git sees, a folder listed once rather than file by file. */
function ignoredEntries() {
  const listed = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: REPO, encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
  return listed.stdout.split('\0').filter(entry => entry !== '')
}

const isDryRun = process.argv.includes('--dry-run')
const doomed = ignoredEntries().filter(entry => !KEPT.test(entry))

for (const entry of doomed) {
  if (!isDryRun) rmSync(join(REPO, entry), { recursive: true, force: true })
  console.log(`${isDryRun ? 'would remove' : 'removed'}  ${entry}`)
}
if (doomed.length === 0) console.log('clean: nothing ignored to remove')
else console.log(`clean: ${doomed.length} ${isDryRun ? 'to remove' : 'removed'}${isDryRun ? '' : '. Run npm install to bring back node_modules and the git hooks.'}`)
