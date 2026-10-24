// The lesson checker. Checks a mod you are building against a lesson's steps:
// it runs `claude plugin validate` on your folder, then the lesson's checks
// with `claude plugin test` on a copy of it, and says which steps pass.
// learn/README.md describes the lessons; `node learn/check.mjs --help` the options.

import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { declarationFiles, dependencyContracts, typecheck } from '../scripts/tsc.mjs'
import { isNoise } from '../web/lib/lesson-checks.mjs'
import { readProgress, recordCheck } from '../web/lib/progress.mjs'
import { PACKAGE_ROOT, workspaceRoot } from '../web/lib/roots.mjs'
import { findTypes, HOW_TO_GET } from '../web/lib/types-path.mjs'
import { judge, loadLessons, parseTestOutput, readValidation } from './lib/lessons.mjs'
import { formatLesson, formatList, painter } from './lib/report.mjs'
import { copyLessonSolution, startLesson } from './lib/start.mjs'

const run = promisify(execFile)
const LEARN = dirname(fileURLToPath(import.meta.url))
// The workspace's workshop/, by the server's rule (web/lib/roots.mjs). Asked for when needed, so --help and --solutions run anywhere.
const workshopDir = () => join(workspaceRoot(), 'workshop')

const HELP = `Usage: node learn/check.mjs [lesson] [options]

  (no lesson)          list the lessons and the progress last checked
  <lesson>             check workshop/<lesson> against the lesson's steps
  <lesson> --watch     check again on every save
  --dir <folder>       check this folder instead of workshop/<lesson>
  --solutions          check every lesson's own solution, and that each starter
                       still fails (npm run check runs this)
  --no-types           skip the TypeScript check
  --for-page           the report as the lesson's page shows it, the next step
                       named rather than given as the README's path

The workshop is the workshop/ folder in MOD_LAB_WORKSPACE, else in the working
directory; the home folder is refused.`

function parseArgs(argv) {
  const args = { lesson: null, dir: null, watch: false, solutions: false, types: true, forPage: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--watch') args.watch = true
    else if (arg === '--solutions') args.solutions = true
    else if (arg === '--no-types') args.types = false
    else if (arg === '--for-page') args.forPage = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--dir') args.dir = argv[(i += 1)] ?? null
    else if (!arg.startsWith('-') && args.lesson === null) args.lesson = arg
    else throw new Error(`unknown option ${arg}`)
  }
  return args
}

/** Output that names a temp copy or an absolute path reads better as a repo-relative one. */
function relativizer(pairs) {
  return text => pairs.reduce((out, [from, to]) => out.split(from).join(to), text)
}

async function runCommand(file, args) {
  try {
    const { stdout, stderr } = await run(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

let claudeVersion = null

/** The build of the claude that validates and tests, as `claude --version` answers it; null when it does not. Asked once. */
function claudeBuild() {
  claudeVersion ??= runCommand('claude', ['--version'])
    .then(({ stdout }) => /^(\d+\.\d+\.\d+)/.exec(stdout.trim())?.[1] ?? null)
    .catch(() => null)
  return claudeVersion
}

function manifestName(modDir) {
  try {
    return JSON.parse(readFileSync(join(modDir, '.claude-plugin', 'plugin.json'), 'utf8')).name ?? null
  } catch {
    return null
  }
}

function missingPart(modDir, modPath) {
  if (!existsSync(modDir)) return `${modPath}/ does not exist yet: step 1 makes it`
  if (!existsSync(join(modDir, '.claude-plugin', 'plugin.json'))) return `${modPath}/.claude-plugin/plugin.json is missing`
  if (!existsSync(join(modDir, 'hooks', 'hooks.json'))) return `${modPath}/hooks/hooks.json is missing`
  return null
}

const SKIPPED = new Set(['node_modules', '.git', 'checks'])

/** Copies the mod without its own tests or the types the engine lays, and adds the lesson's checks. */
function stageCopy(modDir, lesson) {
  const root = mkdtempSync(join(tmpdir(), 'mod-lab-learn-'))
  const copy = join(root, basename(modDir))
  const laid = join(modDir, '.claude-plugin', 'types')
  cpSync(modDir, copy, {
    recursive: true,
    filter: source => {
      if (source === laid || source.startsWith(laid + sep)) return false
      if (SKIPPED.has(basename(source)) && dirname(source) === modDir) return false
      return !/\.test\.tsx?$/.test(source)
    },
  })
  cpSync(join(lesson.dir, 'checks'), join(copy, 'checks'), { recursive: true })
  return { root, copy }
}

async function runChecks(modDir, modPath, lesson) {
  const { root, copy } = stageCopy(modDir, lesson)
  try {
    const result = await runCommand('claude', ['plugin', 'test', copy])
    const local = relativizer([
      [join(copy, 'checks'), `${lesson.path}/checks`],
      [copy, modPath],
    ])
    const output = local(`${result.stdout}${result.stderr}`)
    return { files: parseTestOutput(output), output }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Type-checks the mod against the declarations, found as the explorer finds them; `root` is the workspace for a workshop mod. */
function runTypes(modDir, root) {
  const { path, version } = findTypes({
    explicit: process.env.MOD_LAB_TYPES,
    roots: [modDir, join(PACKAGE_ROOT, 'mods', 'mod-lab'), join(PACKAGE_ROOT, 'mods', 'scratch-mod')],
    workspace: root,
  })
  if (path === null) {
    const which = version === null ? '' : ` for Claude Code ${version}`
    return { status: null, output: `skipped: no claude-code.d.ts found${which}. ${HOW_TO_GET}` }
  }
  const include = ['hooks', 'types'].map(part => join(modDir, part)).filter(existsSync)
  const result = typecheck({ include, files: [...declarationFiles(path), ...dependencyContracts(modDir)] })
  return { ...result, output: result.output.split(`${root}${sep}`).join('') }
}

/** Validates, then runs the checks and the type check side by side. Paths are shown from `root`. */
export async function checkLesson(lesson, modDir, { types = true, root = workspaceRoot() } = {}) {
  const modPath = relative(root, modDir) || '.'
  const missing = missingPart(modDir, modPath)
  if (missing !== null) {
    return { judged: judge(lesson, { missing }), validation: null, tests: null, types: null, modPath }
  }
  const validated = await runCommand('claude', ['plugin', 'validate', '--json', modDir])
  let report
  try {
    report = JSON.parse(validated.stdout)
  } catch {
    report = { success: false, manifest: { errors: [{ message: (validated.stdout + validated.stderr).trim() }] } }
  }
  const local = relativizer([[`${modDir}${sep}`, `${modPath}/`]])
  const validation = readValidation(JSON.parse(local(JSON.stringify(report))), manifestName(modDir))
  if (!validation.ok) {
    return { judged: judge(lesson, { validation }), validation, tests: null, types: null, modPath }
  }
  const [tests, typed] = await Promise.all([runChecks(modDir, modPath, lesson), types ? Promise.resolve().then(() => runTypes(modDir, root)) : null])
  return { judged: judge(lesson, { validation, tests }), validation, tests, types: typed, modPath }
}

/** Workspace lessons get a source reference; a starter is copied only while its working folder is absent. */
function startFromStarter(lesson, modDir, paint) {
  if (resolve(modDir) !== join(workshopDir(), lesson.mod)) return
  const solutionFolder = join(workspaceRoot(), 'solutions', lesson.id)
  copyLessonSolution(lesson, solutionFolder)
  console.log(paint.dim(`Reference solution: ${relative(workspaceRoot(), solutionFolder)}/ (source only; not loaded).\n`))
  if (lesson.starter !== null && startLesson(lesson, modDir) !== null)
    console.log(paint.live(`Copied the starter to ${relative(workspaceRoot(), modDir)}/; edit it there.\n`))
}

/**
 * The lesson's README as the person can open it: from the workspace in a clone, where the
 * package is the workspace, and by its full path in an npm install, which is elsewhere.
 */
function readmeOf(lesson) {
  const path = join(lesson.dir, 'README.md')
  const shown = relative(workspaceRoot(), path)
  return shown.startsWith('..') || isAbsolute(shown) ? path : shown
}

/** Checks the mod and prints the report; a check of the lesson's own folder is recorded, report and all, in the workspace's state. */
async function checkOnce(lesson, modDir, lessons, args, paint) {
  const result = await checkLesson(lesson, modDir, { types: args.types })
  const index = lessons.indexOf(lesson)
  const report = { ...result, nextLesson: lessons[index + 1] ?? null, claudeVersion: await claudeBuild() }
  if (resolve(modDir) === join(workshopDir(), lesson.mod)) {
    const { passed, total } = result.judged
    // The recorded report is the one the lesson's page shows, above the steps it names.
    recordCheck(workspaceRoot(), lesson.id, { passed, total, report: formatLesson({ ...report, readme: null, paint: painter(false) }) })
  }
  console.log(formatLesson({ ...report, readme: args.forPage ? null : readmeOf(lesson), paint }))
  return result.judged
}

function watchLesson(lesson, modDir, lessons, args, paint) {
  const parent = dirname(modDir)
  const name = basename(modDir)
  mkdirSync(parent, { recursive: true })
  let timer = null
  let running = false
  let again = false
  const pass = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    process.stdout.write('\x1b[2J\x1b[H')
    try {
      await checkOnce(lesson, modDir, lessons, args, paint)
    } catch (error) {
      console.error(error)
    }
    console.log(paint.dim(`\nWatching ${relative(workspaceRoot(), modDir)}; checks again on save. Ctrl+C stops.`))
    running = false
    if (again) {
      again = false
      void pass()
    }
  }
  watch(parent, { recursive: true }, (event, file) => {
    if (file === null) return
    const changed = String(file)
    if (changed !== name && !changed.startsWith(name + sep)) return
    if (isNoise(changed)) return
    clearTimeout(timer)
    timer = setTimeout(pass, 250)
  })
  void pass()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const paint = painter(process.stdout.isTTY && !process.env.NO_COLOR)
  const lessons = loadLessons(LEARN)
  if (args.help) return console.log(HELP)
  if (args.solutions) {
    let failed = 0
    // Solutions are type-checked by npm run typecheck, with the lessons' checks.
    for (const lesson of lessons) {
      const result = await checkLesson(lesson, join(lesson.dir, 'solution'), { types: false, root: PACKAGE_ROOT })
      if (result.judged.isDone) console.log(`${paint.ok('✓')} ${lesson.id} ${result.judged.passed}/${result.judged.total}`)
      else {
        failed += 1
        console.log(formatLesson({ ...result, nextLesson: null, paint, claudeVersion: await claudeBuild() }))
      }
      // A starter that passes has nothing left to do: its lesson, or the engine behaviour it rests on, has changed.
      if (lesson.starter === null) continue
      const start = await checkLesson(lesson, lesson.starter, { types: false, root: PACKAGE_ROOT })
      if (!start.judged.isDone) console.log(`${paint.ok('✓')} ${lesson.id} starter fails at step ${start.judged.current.number}, as it should`)
      else {
        failed += 1
        console.log(`${paint.fail('✗')} ${lesson.id} starter passes every check: nothing is left to solve`)
      }
    }
    process.exitCode = failed === 0 ? 0 : 1
    return undefined
  }
  if (args.lesson === null) return console.log(formatList(lessons, readProgress(workspaceRoot()).lessons, paint))
  const lesson = lessons.find(one => one.id === args.lesson)
  if (lesson === undefined) {
    console.error(`No lesson is named ${args.lesson}. The lessons: ${lessons.map(one => one.id).join(', ')}`)
    process.exitCode = 1
    return undefined
  }
  const modDir = resolve(args.dir ?? join(workshopDir(), lesson.mod))
  startFromStarter(lesson, modDir, paint)
  if (args.watch) return watchLesson(lesson, modDir, lessons, args, paint)
  const judged = await checkOnce(lesson, modDir, lessons, args, paint)
  process.exitCode = judged.isDone ? 0 : 1
  return undefined
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
