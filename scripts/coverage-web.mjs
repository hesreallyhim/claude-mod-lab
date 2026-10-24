// `npm run coverage:web`: the web tests under c8, with the thresholds in .c8rc.json.
// `npm run coverage:web -- --page` adds the explorer page's coverage: the web tests run
// with NODE_V8_COVERAGE into c8's temporary folder, then web/e2e-page.mjs with
// PAGE_COVERAGE=1 (its own Node process under NODE_V8_COVERAGE too, so the server code
// the page reaches counts), and `c8 report` reports the two together. That report does
// not check the thresholds, which stay on the web tests alone; like e2e-page it drives
// the installed Chrome and starts `claude`, so it is local. The run also leaves
// coverage/css-rules.json, the stylesheet rules the pages used.

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const C8 = createRequire(import.meta.url).resolve('c8/bin/c8.js')
const TESTS = 'web/test/*.test.mjs'
// c8's temporary folder: reports-dir in .c8rc.json, then tmp, as c8 has it by default.
const TEMP = join(REPO, 'coverage', 'tmp')

/**
 * Runs node with the arguments and extra environment, its output shown; returns its exit status.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function node(args, env = {}) {
  const { status, error } = spawnSync(process.execPath, args, {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (error) throw error
  return status ?? 1
}

const extra = process.argv.slice(2)
if (extra.some(arg => arg !== '--page')) {
  console.error(`coverage-web: unknown argument ${extra.find(arg => arg !== '--page')}; the one option is --page`)
  process.exit(2)
}

if (!extra.includes('--page')) process.exit(node([C8, process.execPath, '--test', TESTS]))

rmSync(TEMP, { recursive: true, force: true })
mkdirSync(TEMP, { recursive: true })
const tests = node(['--test', TESTS], { NODE_V8_COVERAGE: TEMP })
const page = node(['web/e2e-page.mjs'], { NODE_V8_COVERAGE: TEMP, PAGE_COVERAGE: '1' })
const report = node([C8, 'report', '--no-check-coverage'])
if (tests !== 0) console.error('coverage-web: the web tests failed')
if (page !== 0) console.error('coverage-web: e2e-page failed')
process.exit(tests || page || report)
