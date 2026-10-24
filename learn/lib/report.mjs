// The checker's text: one lesson's steps with what failed and why, what the
// validator reads in the module, and where to go next; or the list of lessons.

// The explorer page's version comparison, which has no DOM in it, so the two say the same of a build.
import { compareVersions } from '../../web/public/versions.js'

const PLAIN = { ok: s => s, fail: s => s, dim: s => s, live: s => s, bold: s => s }
const COLOR = {
  ok: s => `\x1b[32m${s}\x1b[39m`,
  fail: s => `\x1b[31m${s}\x1b[39m`,
  dim: s => `\x1b[2m${s}\x1b[22m`,
  live: s => `\x1b[36m${s}\x1b[39m`,
  bold: s => `\x1b[1m${s}\x1b[22m`,
}

export function painter(isColor) {
  return isColor ? COLOR : PLAIN
}

const MAX_FAILED_TESTS = 3
const MAX_DETAIL_LINES = 8
const MAX_TYPE_ERRORS = 6

// A step past the current one that fails is one not reached yet, not a second failure.
function mark(step, current, paint) {
  if (step.status === 'pass') return paint.ok('✓')
  if (step.status === 'live') return paint.live('◇')
  if (step === current) return paint.fail('✗')
  return paint.dim('·')
}

const UNANSWERED = /^HooksError: (?:\$\.\S+: )?no implementation for (\S+)/

/** The test kit's words for an event nothing answered, when that is why the test failed, said from the learner's side. */
function gloss(detail) {
  const event = UNANSWERED.exec(detail[0] ?? '')?.[1]
  return event === undefined ? null : `no hook in the mod answered ${event}, and in a check nothing stands beneath the mod to answer it`
}

function stepLines(step, current, paint) {
  const title = `${step.number}. ${step.title}`
  const lines = [`  ${mark(step, current, paint)} ${step.status === 'live' ? `${title} ${paint.dim('(in a session)')}` : title}`]
  if (step !== current) return lines
  for (const test of step.failed.slice(0, MAX_FAILED_TESTS)) {
    lines.push(`       ${paint.fail('✗')} ${test.name}`)
    const meaning = gloss(test.detail)
    const detail = meaning === null ? test.detail : [meaning]
    for (const line of detail.slice(0, MAX_DETAIL_LINES)) lines.push(`         ${paint.dim(line)}`)
  }
  if (step.failed.length > MAX_FAILED_TESTS) lines.push(`       ${paint.dim(`and ${step.failed.length - MAX_FAILED_TESTS} more`)}`)
  for (const problem of step.problems) lines.push(`       ${paint.fail('✗')} ${problem}`)
  return lines
}

function factLines(validation, paint) {
  if (validation === null || !validation.ok) return []
  const { facts } = validation
  const rows = [
    ['hooks', facts.hooks.join(', ')],
    ['calls', facts.calls.join(', ')],
    ['answers', facts.answers.join(', ')],
    ['gating', facts.gating.join(', ')],
    ['state', facts.state.join('; ')],
  ].filter(([, value]) => value !== '' && value !== 'nothing')
  if (rows.length === 0) return ['', paint.bold('What claude plugin validate reads in the module'), `  ${paint.dim('no hooks yet')}`]
  return ['', paint.bold('What claude plugin validate reads in the module'), ...rows.map(([label, value]) => `  ${label.padEnd(8)} ${value}`)]
}

function typeLines(types, paint) {
  if (types === null) return []
  if (types.status === null) return ['', `${paint.bold('TypeScript')}: ${paint.dim(types.output)}`]
  const errors = types.output.split('\n').filter(line => / error TS\d+:/.test(line))
  if (errors.length === 0) return ['', `${paint.bold('TypeScript')}: no errors`]
  const shown = errors.slice(0, MAX_TYPE_ERRORS).map(line => `  ${line}`)
  const more = errors.length > MAX_TYPE_ERRORS ? [`  ${paint.dim(`and ${errors.length - MAX_TYPE_ERRORS} more`)}`] : []
  return ['', `${paint.bold('TypeScript')}: ${errors.length} error${errors.length === 1 ? '' : 's'}`, ...shown, ...more]
}

/** A line where the claude the checks ran on is older than the lesson needs, which alone can fail a step; nothing otherwise. */
function versionLines(lesson, claudeVersion, paint) {
  if (typeof lesson.minVersion !== 'string' || claudeVersion === null || compareVersions(claudeVersion, lesson.minVersion) >= 0) return []
  return [paint.fail('This lesson needs a newer version of Claude Code than the one its checks ran on, so a step can fail for that reason alone.')]
}

/** The test run's own words, when a step's checks did not run at all. */
function runnerLines(judged, tests, paint) {
  const silent = judged.current?.problems.some(problem => problem.startsWith('its checks did not run'))
  if (!silent || !tests?.output) return []
  const tail = tests.output.trim().split('\n').slice(-12)
  return ['', paint.bold('The test run said'), ...tail.map(line => `  ${paint.dim(line)}`)]
}

/** Where a step is: below, on the lesson's page (`readme` null), or its README's path and anchor, in the terminal. */
function stepPlace(step, readme) {
  return readme === null ? `step ${step.number}, ${step.title}, below` : `step ${step.number}, ${readme}#${step.anchor}`
}

function nextLines(judged, nextLesson, readme, paint) {
  const { current, liveFirst } = judged
  if (current === null) {
    const after = nextLesson === null ? 'That was the last lesson.' : `Next lesson: ${nextLesson.id} (${nextLesson.title}), on its page in the explorer.`
    const all = judged.total === 1 ? 'The checked step passes.' : `All ${judged.total} checked steps pass.`
    return ['', paint.ok(all), after]
  }
  const lines = ['']
  if (liveFirst !== null) {
    lines.push(`${paint.live('In a session')}: ${stepPlace(liveFirst, readme)}`)
  }
  lines.push(`${paint.bold('Next')}: ${stepPlace(current, readme)}`)
  lines.push(paint.dim(`${judged.passed} of ${judged.total} checked steps pass.`))
  return lines
}

/**
 * The full report for one lesson. `claudeVersion` is the build `claude --version` answered, or null;
 * `readme` is the lesson's README as the person can open it, its path in the package by default, or
 * null for the report the lesson's page shows, where the steps are below it.
 */
export function formatLesson({ judged, validation, tests, types, modPath, nextLesson, paint, claudeVersion = null, readme }) {
  const { lesson } = judged
  const head = `${paint.bold(`${lesson.id}: ${lesson.title}`)}  ${paint.dim(modPath)}`
  return [
    head,
    paint.dim(lesson.summary),
    ...versionLines(lesson, claudeVersion, paint),
    '',
    ...judged.steps.flatMap(step => stepLines(step, judged.current, paint)),
    ...runnerLines(judged, tests, paint),
    ...factLines(validation, paint),
    ...typeLines(types, paint),
    ...nextLines(judged, nextLesson, readme === undefined ? `${lesson.path}/README.md` : readme, paint),
  ].join('\n')
}

function when(at) {
  return new Date(at).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Every lesson with the progress last recorded for it. */
export function formatList(lessons, progress, paint) {
  const width = Math.max(...lessons.map(lesson => lesson.id.length))
  const titleWidth = Math.max(...lessons.map(lesson => lesson.title.length))
  const lines = [paint.bold('Lessons'), paint.dim("A lesson's page in the explorer checks your mod as you save; npx claude-mod-lab@alpha learn <name> --once checks it here.")]
  for (const kind of ['tutorial', 'challenge']) {
    const ofKind = lessons.filter(lesson => lesson.kind === kind)
    if (ofKind.length === 0) continue
    lines.push('', paint.bold(kind === 'tutorial' ? 'Tutorials' : 'Challenges'))
    for (const lesson of ofKind) {
      const seen = progress[lesson.id]
      const status =
        seen === undefined
          ? paint.dim('not started')
          : `${seen.passed === seen.total ? paint.ok(`${seen.passed}/${seen.total}`) : `${seen.passed}/${seen.total}`} ${paint.dim(`checked ${when(seen.at)}`)}`
      lines.push(`  ${lesson.id.padEnd(width)}  ${lesson.title.padEnd(titleWidth)}  ${status}`)
    }
  }
  return lines.join('\n')
}
