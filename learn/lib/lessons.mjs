// Lessons on disk, and the judgment of a mod against one: which steps its
// validation and its test run satisfy. No process is run here; check.mjs
// runs the validator and the tests and hands their output to these functions.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const KINDS = { tutorials: 'tutorial', challenges: 'challenge' }

function numbered(a, b) {
  return Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b)
}

/**
 * Every lesson under learn/tutorials and learn/challenges, in folder order.
 * A lesson is a folder holding lesson.json, a README, its checks and a
 * solution. Its id is lesson.json's `id`, or the mod's name; a lesson that
 * grows the mod of an earlier one names its own id and shares the mod's
 * folder. `starter` is where a learner who has no folder yet starts from:
 * the lesson's starter/, or a path relative to the lesson, as another's solution.
 */
export function loadLessons(learnDir) {
  const lessons = []
  for (const [folder, kind] of Object.entries(KINDS)) {
    const base = join(learnDir, folder)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort(numbered)) {
      const file = join(base, name, 'lesson.json')
      if (!existsSync(file)) continue
      const data = JSON.parse(readFileSync(file, 'utf8'))
      const dir = join(base, name)
      const starter = join(dir, data.starter ?? 'starter')
      lessons.push({ ...data, id: data.id ?? data.mod, kind, dir, path: `learn/${folder}/${name}`, starter: existsSync(starter) ? starter : null })
    }
  }
  return lessons
}

/** GitHub's anchor for a heading, as the README's `## 3. Counting tool calls` gets it. */
export function anchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-')
}

export function stepAnchor(step, number) {
  return anchor(`${number}. ${step.title}`)
}

const ANSI = /\x1b\[[0-9;]*m/g

/**
 * Reads `claude plugin test` output into test results per file:
 * `checks/2-command.test.ts:` heads a file, `(pass) name [1ms]` is a test,
 * and the indented lines after a `(fail)` say why.
 */
export function parseTestOutput(text) {
  const files = new Map()
  let file = null
  let last = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(ANSI, '')
    const header = /^(\S.*\.test\.tsx?):$/.exec(line)
    if (header !== null) {
      file = header[1]
      if (!files.has(file)) files.set(file, [])
      last = null
      continue
    }
    const result = /^\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(line)
    if (result !== null && file !== null) {
      last = { name: result[2], status: result[1], detail: [] }
      files.get(file).push(last)
      continue
    }
    if (last?.status === 'fail' && (line.startsWith('  ') || line === '')) last.detail.push(line.slice(2))
    else last = null
  }
  for (const results of files.values()) {
    for (const one of results) {
      while (one.detail.length > 0 && one.detail.at(-1).trim() === '') one.detail.pop()
    }
  }
  return files
}

const NOTE = /^\S+ (hooks|calls|answers its own command|gating hook with \.catch|gating hook without \.catch|state writes|state reads): (.*)$/

/**
 * What `claude plugin validate --json` says about a mod: whether it passed,
 * its errors, the manifest's name, and the facts it lists about the module.
 */
export function readValidation(report, manifestName) {
  const parts = [report.manifest, ...(report.contents ?? [])].filter(Boolean)
  const facts = { hooks: [], calls: [], answers: [], gating: [], state: [] }
  for (const part of parts) {
    for (const note of part.notes ?? []) {
      const match = NOTE.exec(note)
      if (match === null) continue
      const [, kind, value] = match
      if (kind === 'hooks') facts.hooks.push(value)
      if (kind === 'calls') facts.calls.push(value)
      if (kind === 'answers its own command') facts.answers.push(value)
      if (kind.startsWith('gating')) facts.gating.push(`${value} ${kind.endsWith('without .catch') ? 'without' : 'with'} .catch`)
      if (kind.startsWith('state') && value !== 'nothing') facts.state.push(`${kind.slice('state '.length)} ${value}`)
    }
  }
  return {
    ok: report.success === true,
    errors: parts.flatMap(part => (part.errors ?? []).map(error => error.message)),
    gatingHooks: parts.flatMap(part => part.gatingHooks ?? []),
    name: manifestName,
    facts,
  }
}

function catchProblems(events, gatingHooks) {
  const problems = []
  for (const event of events) {
    const hooks = gatingHooks.filter(hook => hook.pattern === event)
    if (hooks.length === 0) problems.push(`no ${event} hook yet`)
    for (const hook of hooks.filter(one => !one.hasCatch)) problems.push(`the ${hook.hook} hook has no .catch`)
  }
  return problems
}

/** The calls a step needs the module to make, as the validator lists them (`$.session.cwd`, possibly `(via helper)`). */
function callProblems(calls, facts) {
  if (calls.length === 0) return []
  const listed = (facts.calls ?? []).join(', ')
  return calls
    .filter(call => !new RegExp(`${call.replace(/[$.]/g, '\\$&')}\\b`).test(listed))
    .map(call => `the validator finds no call to ${call} in the module, and this step needs one`)
}

/**
 * Judges each step of `lesson`. `missing` names what is absent when the mod
 * cannot be checked at all; otherwise `validation` is readValidation's answer
 * and `tests` is `{ files, output }` from the test run.
 *
 * A step with `checks` passes when its test file ran and every test in it
 * passed (each event in its `catch` has a hook with a .catch, and each call
 * in its `calls` is one the validator finds in the module); a step
 * with neither `checks` nor `live` passes with a valid module; a `live`
 * step is done in a session and has nothing to check.
 */
export function judge(lesson, { missing = null, validation = null, tests = null }) {
  const steps = lesson.steps.map((step, index) => ({
    number: index + 1,
    title: step.title,
    anchor: stepAnchor(step, index + 1),
    live: step.live ?? null,
    status: step.live ? 'live' : 'todo',
    problems: [],
    failed: [],
  }))
  const first = steps[0]
  const blockedBy = problem => {
    first.status = 'fail'
    first.problems.push(problem)
    return summarize(lesson, steps)
  }
  if (missing !== null) return blockedBy(missing)
  if (!validation.ok) {
    first.status = 'fail'
    first.problems.push(...(validation.errors.length > 0 ? validation.errors : ['claude plugin validate refused the mod']))
    return summarize(lesson, steps)
  }
  if (validation.name !== lesson.mod) {
    return blockedBy(`plugin.json names the mod "${validation.name}"; this lesson's checks look for "${lesson.mod}"`)
  }
  lesson.steps.forEach((step, index) => {
    const judged = steps[index]
    if (step.live) return
    if (!step.checks) {
      judged.status = 'pass'
      return
    }
    const results = tests?.files.get(step.checks) ?? []
    if (results.length === 0) judged.problems.push('its checks did not run; the test output below says why')
    judged.failed = results.filter(result => result.status === 'fail')
    judged.problems.push(...catchProblems(step.catch ?? [], validation.gatingHooks))
    judged.problems.push(...callProblems(step.calls ?? [], validation.facts))
    judged.status = judged.problems.length === 0 && judged.failed.length === 0 ? 'pass' : 'fail'
  })
  return summarize(lesson, steps)
}

function summarize(lesson, steps) {
  const checked = steps.filter(step => !step.live)
  const current = steps.find(step => step.status === 'fail') ?? null
  const before = current === null ? null : steps[current.number - 2]
  return {
    lesson,
    steps,
    current,
    // A live step just before the first failing one is where the learner probably is.
    liveFirst: before?.live ? before : null,
    passed: checked.filter(step => step.status === 'pass').length,
    total: checked.length,
    isDone: current === null,
  }
}
