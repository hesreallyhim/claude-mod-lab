// compat.json, the Claude Code builds the lab supports, is edited at the
// repository root alone. An installed plugin reads only its own folder, so
// this copies it into each plugin that reads it. With --check it writes
// nothing, and fails when the root file is malformed or a copy differs.
// mod-lab checks the session's build with it; mod-lab-bridge passes it to the
// explorer in its hello.
// `npm run sync-compat` copies; `npm run check` checks, and the release script copies.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** The plugins that read compat.json, each from a copy in its own folder. */
const COPIES = ['mods/mod-lab/compat.json', 'mods/mod-lab-bridge/compat.json']
const VERSION = /^\d+\.\d+\.\d+$/

/** What is wrong with the file's shape, as mods/mod-lab/hooks/compat.ts reads it; empty when nothing is. */
function problemsOf(data) {
  const problems = []
  for (const field of ['floor', 'testedThrough']) {
    if (typeof data?.[field] !== 'string' || !VERSION.test(data[field])) problems.push(`${field} is not a version such as 2.1.299`)
  }
  for (const table of ['plugins', 'capabilities']) {
    if (data?.[table] === null || typeof data?.[table] !== 'object' || Array.isArray(data[table])) {
      problems.push(`${table} is not an object`)
      continue
    }
    for (const [name, need] of Object.entries(data[table])) {
      const isNeed = typeof need?.since === 'string' && VERSION.test(need.since) && Array.isArray(need.uses) && need.uses.every(use => typeof use === 'string')
      if (!isNeed) problems.push(`${table}.${name} is not { "since": "<version>", "uses": ["<a name newer than the floor>", ...] }`)
    }
  }
  return problems
}

const isCheck = process.argv.includes('--check')
const source = readFileSync(join(REPO, 'compat.json'), 'utf8')
let data
try {
  data = JSON.parse(source)
} catch (error) {
  console.error(`compat.json is not JSON: ${error.message}`)
  process.exit(1)
}
const problems = problemsOf(data)
if (problems.length > 0) {
  console.error(`compat.json: ${problems.join('; ')}`)
  process.exit(1)
}

const stale = COPIES.filter(copy => !existsSync(join(REPO, copy)) || readFileSync(join(REPO, copy), 'utf8') !== source)
if (isCheck) {
  if (stale.length > 0) {
    console.error(`${stale.join(', ')} differs from compat.json: run npm run sync-compat`)
    process.exit(1)
  }
  console.log(`ok   compat.json and its ${COPIES.length === 1 ? 'copy' : `${COPIES.length} copies`}`)
} else {
  for (const copy of stale) writeFileSync(join(REPO, copy), source)
  console.log(stale.length === 0 ? 'compat.json: every copy is current' : `compat.json copied to ${stale.join(', ')}`)
}
