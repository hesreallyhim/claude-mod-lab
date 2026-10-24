import assert from 'node:assert/strict'
import { test } from 'node:test'

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { anchor, judge, loadLessons, parseTestOutput, readValidation } from '../lib/lessons.mjs'
import { formatLesson, painter } from '../lib/report.mjs'

// Output in the shape `claude plugin test` prints, colours included.
const RUN = [
  '',
  'checks/2-command.test.ts:',
  '\x1b[32m(pass)\x1b[0m registers the command [1.12ms]',
  '(pass) answers with text [0.4ms]',
  '',
  'checks/3-time.test.ts:',
  '(fail) lists each tool [22.31ms]',
  '  AssertionError: expect(received).toContain()',
  '  ',
  '  Expected: containing "3 tool calls"',
  '  Received: "No tool calls yet."',
  '',
  '(pass) passes the result on [3ms]',
  '',
  ' 3 pass',
  ' 1 fail',
  'Ran 4 tests across 2 files. [0.31s]',
].join('\n')

const LESSON = {
  mod: 'stopwatch',
  title: 'Your first mod',
  path: 'learn/tutorials/1-stopwatch',
  steps: [
    { title: 'The folder' },
    { title: 'A command', checks: 'checks/2-command.test.ts' },
    { title: 'Timing tool calls', checks: 'checks/3-time.test.ts', catch: ['tool.call'] },
    { title: 'Watch it run', live: true },
    { title: 'Keep the totals', checks: 'checks/5-state.test.ts' },
  ],
}

function validation(overrides = {}) {
  return { ok: true, errors: [], gatingHooks: [], name: 'stopwatch', facts: {}, ...overrides }
}

test('a test run is read per file, with the reasons a test failed', () => {
  const files = parseTestOutput(RUN)

  assert.deepEqual([...files.keys()], ['checks/2-command.test.ts', 'checks/3-time.test.ts'])
  assert.deepEqual(
    files.get('checks/2-command.test.ts').map(one => [one.name, one.status]),
    [
      ['registers the command', 'pass'],
      ['answers with text', 'pass'],
    ],
  )
  const [failed, passed] = files.get('checks/3-time.test.ts')
  assert.equal(failed.status, 'fail')
  assert.deepEqual(failed.detail, ['AssertionError: expect(received).toContain()', '', 'Expected: containing "3 tool calls"', 'Received: "No tool calls yet."'])
  assert.deepEqual(passed.detail, [])
})

test('the validator report gives gating hooks and the facts it lists', () => {
  const report = {
    success: true,
    manifest: { errors: [], notes: ['types ./types/index.d.ts declares state: stopwatch.totals'], gatingHooks: [] },
    contents: [
      {
        errors: [],
        notes: [
          './register.ts hooks: session.start, tool.call',
          './register.ts gating hook without .catch: tool.call',
          './register.ts calls: $.ui.status',
          './register.ts state writes: nothing',
          './register.ts state reads: stopwatch.totals',
        ],
        gatingHooks: [{ pattern: 'tool.call', hook: 'tool.call', hasCatch: false }],
      },
    ],
  }

  const read = readValidation(report, 'stopwatch')

  assert.equal(read.ok, true)
  assert.deepEqual(read.facts.hooks, ['session.start, tool.call'])
  assert.deepEqual(read.facts.calls, ['$.ui.status'])
  assert.deepEqual(read.facts.gating, ['tool.call without .catch'])
  assert.deepEqual(read.facts.state, ['reads stopwatch.totals'])
  assert.equal(read.gatingHooks.length, 1)
})

test('a missing folder fails the first step and leaves the rest unchecked', () => {
  const judged = judge(LESSON, { missing: 'workshop/stopwatch/ does not exist yet' })

  assert.equal(judged.current.number, 1)
  assert.deepEqual(judged.current.problems, ['workshop/stopwatch/ does not exist yet'])
  assert.deepEqual(
    judged.steps.map(step => step.status),
    ['fail', 'todo', 'todo', 'live', 'todo'],
  )
  assert.equal(judged.passed, 0)
  assert.equal(judged.total, 4)
})

test("a manifest under another name fails the first step: the checks address the lesson's name", () => {
  const judged = judge(LESSON, { validation: validation({ name: 'stopwatches' }) })

  assert.match(judged.current.problems[0], /names the mod "stopwatches"/)
})

test('steps pass on their own checks; the first that fails is the current one', () => {
  const tests = { files: parseTestOutput(RUN), output: RUN }
  const judged = judge(LESSON, { validation: validation(), tests })

  assert.deepEqual(
    judged.steps.map(step => step.status),
    ['pass', 'pass', 'fail', 'live', 'fail'],
  )
  assert.equal(judged.current.number, 3)
  assert.deepEqual(
    judged.current.failed.map(one => one.name),
    ['lists each tool'],
  )
  assert.deepEqual(judged.current.problems, ['no tool.call hook yet'])
  assert.deepEqual(judged.steps[4].problems, ['its checks did not run; the test output below says why'])
})

test('a gating hook without its .catch fails the step that asks for one', () => {
  const output = RUN.replace('(fail) lists each tool', '(pass) lists each tool')
  const tests = { files: parseTestOutput(output), output }
  const gatingHooks = [{ pattern: 'tool.call', hook: 'tool.call{tool=Read}', hasCatch: false }]

  const judged = judge(LESSON, { validation: validation({ gatingHooks }), tests })

  assert.equal(judged.current.number, 3)
  assert.deepEqual(judged.current.problems, ['the tool.call{tool=Read} hook has no .catch'])
})

test('a live step just before the current one is pointed out', () => {
  const output = RUN.replace('(fail) lists each tool', '(pass) lists each tool')
  const tests = { files: parseTestOutput(output), output }
  const gatingHooks = [{ pattern: 'tool.call', hook: 'tool.call', hasCatch: true }]

  const judged = judge(LESSON, { validation: validation({ gatingHooks }), tests })

  assert.equal(judged.current.number, 5)
  assert.equal(judged.liveFirst.number, 4)
  assert.equal(judged.isDone, false)
})

test("README anchors follow GitHub's headings", () => {
  assert.equal(anchor('3. Timing tool calls'), '3-timing-tool-calls')
  assert.equal(anchor("6. Keep the totals across a reload"), '6-keep-the-totals-across-a-reload')
  assert.equal(anchor('2. `$.state`, and why'), '2-state-and-why')
})

test('a step that names calls fails while the validator finds none of them in the module', () => {
  const lesson = { ...LESSON, steps: [{ title: 'The folder' }, { title: 'Ask', checks: 'checks/2-command.test.ts', calls: ['$.session.cwd'] }] }
  const tests = { files: parseTestOutput(RUN), output: RUN }
  const facts = calls => ({ hooks: [], calls, answers: [], gating: [], state: [] })

  const without = judge(lesson, { validation: validation({ facts: facts(['$.command.register']) }), tests })
  const viaHelper = judge(lesson, { validation: validation({ facts: facts(['$.command.register, $.session.cwd (via where)']) }), tests })

  assert.deepEqual(without.current.problems, ['the validator finds no call to $.session.cwd in the module, and this step needs one'])
  assert.equal(viaHelper.isDone, true)
})

test('a refusal is read from the validator report as an error', () => {
  const report = { success: false, manifest: { errors: [], notes: [] }, contents: [{ errors: [{ message: 'register.ts does not parse: Unexpected ; (line 3)' }], notes: [] }] }

  const read = readValidation(report, 'stopwatch')

  assert.equal(read.ok, false)
  assert.deepEqual(read.errors, ['register.ts does not parse: Unexpected ; (line 3)'])
})

function lessonFolder(root, folder, lesson, withStarter) {
  const dir = join(root, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lesson.json'), JSON.stringify(lesson))
  if (withStarter) mkdirSync(join(dir, 'starter'))
  return dir
}

test('lessons load in the order of their folder numbers, a letter after the number ordering within it, with their ids and starters', () => {
  const root = mkdtempSync(join(tmpdir(), 'lessons-'))
  lessonFolder(root, 'tutorials/10-later', { mod: 'later-m1', steps: [] }, false)
  // The lessons before the first numbered one: 0b after 0a, both before 2.
  lessonFolder(root, 'tutorials/0b-second', { mod: 'second-m6', steps: [] }, false)
  lessonFolder(root, 'tutorials/0a-opening', { mod: 'opening-m5', steps: [] }, false)
  const first = lessonFolder(root, 'tutorials/2-first', { mod: 'first-m2', steps: [] }, false)
  lessonFolder(root, 'tutorials/11-grows', { id: 'grows-i3', mod: 'first-m2', starter: '../2-first', steps: [] }, false)
  const own = lessonFolder(root, 'challenges/1-own', { mod: 'own-m4', steps: [] }, true)

  const lessons = loadLessons(root)

  assert.deepEqual(lessons.map(lesson => [lesson.id, lesson.kind]), [
    ['opening-m5', 'tutorial'],
    ['second-m6', 'tutorial'],
    ['first-m2', 'tutorial'],
    ['later-m1', 'tutorial'],
    ['grows-i3', 'tutorial'],
    ['own-m4', 'challenge'],
  ])
  assert.equal(lessons[2].starter, null)
  assert.equal(lessons[4].starter, first)
  assert.equal(lessons[4].mod, 'first-m2')
  assert.equal(lessons[5].starter, join(own, 'starter'))
})

test("the kit's error for an event nothing answered is said from the learner's side", () => {
  const detail = ['HooksError: $.ui.mount: no implementation for ui.render', '', 'nothing beneath the plugins answers ui.render']
  const judged = judge(LESSON, { validation: validation(), tests: { files: new Map([['checks/2-command.test.ts', [{ name: 'the pane draws', status: 'fail', detail }]]]), output: '' } })

  const text = formatLesson({ judged, validation: null, tests: null, types: null, modPath: 'workshop/stopwatch', nextLesson: null, paint: painter(false) })

  assert.match(text, /no hook in the mod answered ui\.render/)
  assert.doesNotMatch(text, /no implementation/)
})

test("the next step points at the lesson's README in the terminal, and at the step below on the lesson's page", () => {
  const judged = judge(LESSON, { missing: 'workshop/stopwatch/ does not exist yet: step 1 makes it' })
  const report = readme =>
    formatLesson({ judged, validation: null, tests: null, types: null, modPath: 'workshop/stopwatch', nextLesson: null, paint: painter(false), readme })

  assert.match(report(undefined), new RegExp(`^Next: step 1, ${LESSON.path}/README\\.md#1-`, 'm'))
  // From an npm install the package is not under the workspace, so the checker names the README by its full path.
  assert.match(report('/pkg/learn/tutorials/1-x/README.md'), /^Next: step 1, \/pkg\/learn\/tutorials\/1-x\/README\.md#1-/m)
  // The page shows the steps under the report, so it names the step rather than a file.
  assert.match(report(null), new RegExp(`^Next: step 1, ${LESSON.steps[0].title}, below$`, 'm'))
  assert.doesNotMatch(report(null), /README\.md/)
})

test("the report says so only when the claude its checks ran on is older than the lesson needs, with no version number", () => {
  const lesson = { ...LESSON, id: 'stopwatch', summary: 'times tool calls', minVersion: '2.1.300' }
  const judged = judge(lesson, { missing: 'workshop/stopwatch/ does not exist yet: step 1 makes it' })
  const report = claudeVersion =>
    formatLesson({ judged, validation: null, tests: null, types: null, modPath: 'workshop/stopwatch', nextLesson: null, paint: painter(false), claudeVersion })

  assert.match(report('2.1.299'), /needs a newer version of Claude Code than the one its checks ran on, so a step can fail for that reason alone/)
  assert.doesNotMatch(report('2.1.299'), /\d+\.\d+\.\d+/)
  assert.doesNotMatch(report('2.1.303'), /newer version|Claude Code \d/)
  assert.doesNotMatch(report(null), /newer version|Claude Code \d/)
})

// Every lesson in the repository: each step's check file exists, and each step heading the checker links to is in its README.
const LEARN = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const lesson of loadLessons(LEARN)) {
  test(`${lesson.id}: each step's checks exist and its README has each step's heading`, () => {
    const readme = readFileSync(join(lesson.dir, 'README.md'), 'utf8')
    const anchors = [...readme.matchAll(/^## (.+)$/gm)].map(match => anchor(match[1]))
    lesson.steps.forEach((step, index) => {
      if (step.checks) assert.ok(existsSync(join(lesson.dir, step.checks)), `${step.checks} is missing`)
      assert.ok(anchors.includes(anchor(`${index + 1}. ${step.title}`)), `no heading "## ${index + 1}. ${step.title}"`)
    })
  })
  // The lowest build its solution passes on; the checker and the Lessons page show it.
  test(`${lesson.id}: lesson.json gives a minVersion`, () => {
    assert.match(lesson.minVersion ?? '', /^\d+\.\d+\.\d+$/)
  })
}
