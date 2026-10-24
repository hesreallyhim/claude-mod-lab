// The line limit: fails on any file over 750 lines, naming each with its count.
// With no arguments it checks the tracked files (npm run lines); given paths,
// those; with --staged, the files staged for commit as they are staged, which
// is how the pre-commit hook runs it.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LIMIT = 750

/** Files the limit does not apply to, each with its reason. Binary files are left out as well. */
const EXCEPTIONS = [
  { test: path => path.endsWith('.d.ts'), reason: 'type declarations: their length follows the API they declare' },
  { test: path => path.split('/').at(-1) === 'package-lock.json', reason: 'written by npm' },
  { test: path => path === 'web/public/style.css', reason: 'until I3 factors the CSS' },
]

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 64 * 1024 * 1024 })

/** A file's content, or null where there is no file to read (deleted, or a folder). */
function readTree(path) {
  try {
    return readFileSync(join(REPO, path))
  } catch (error) {
    if (['ENOENT', 'EISDIR'].includes(error.code)) return null
    throw error
  }
}

const readStaged = path => git('show', `:${path}`)

/** A NUL byte in the first 8 KB, as git itself tells a binary file. */
const isBinary = content => content.subarray(0, 8192).includes(0)

function lineCount(content) {
  let lines = 0
  for (let at = content.indexOf(10); at !== -1; at = content.indexOf(10, at + 1)) lines += 1
  return content.length > 0 && content.at(-1) !== 10 ? lines + 1 : lines
}

const args = process.argv.slice(2)
const staged = args.includes('--staged')
const given = args.filter(arg => arg !== '--staged')
const paths = staged
  ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').toString().split('\0').filter(Boolean)
  : given.length > 0
    ? given.map(path => relative(REPO, resolve(path)))
    : git('ls-files', '-z').toString().split('\0').filter(Boolean)

const over = []
let checked = 0
for (const path of paths) {
  if (EXCEPTIONS.some(exception => exception.test(path))) continue
  const content = staged ? readStaged(path) : readTree(path)
  if (content === null || isBinary(content)) continue
  checked += 1
  const lines = lineCount(content)
  if (lines > LIMIT) over.push({ path, lines })
}

if (over.length > 0) {
  for (const { path, lines } of over) console.error(`${path}: ${lines} lines, over the limit of ${LIMIT}`)
  console.error(`Split ${over.length === 1 ? 'it' : 'them'}, or add an exception with its reason in scripts/line-limit.mjs.`)
  process.exit(1)
}
console.log(`line limit: ${checked} files, none over ${LIMIT} lines`)
