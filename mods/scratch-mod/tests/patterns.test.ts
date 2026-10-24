import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The test's own hooks sit beneath every plugin: they stand for the engine,
// so what one answers is what the plugin's next(e) resolves to.

function command(name: string): CommandRunInput {
  return { command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } }
}

function startSession(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

test('rewrite: the chain beneath sees the trimmed text and the added context', async ($, on) => {
  const received: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', ($, e) => {
    received.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context ?? [] }
  })

  await $.prompt.submit({ text: '   tidy me z1   ', wait: false, origin: { kind: 'composer' } })

  expect(received).toEqual([{ text: 'tidy me z1', context: ['scratch saw this prompt'] }])
})

test('guard: a write under secrets/ is refused and never reaches the tool', async ($, on) => {
  const written: string[] = []
  on('tool.call', { tool: 'Write' }, ($, e) => {
    written.push(e.file_path)
    return { result: 'written' }
  })

  const refused = await $.tool.call({ tool: 'Write', file_path: '/repo/secrets/key-q.txt', content: 'x' })
  const allowed = await $.tool.call({ tool: 'Write', file_path: '/repo/notes/q.txt', content: 'x' })

  expect(refused).toEqual({ deny: 'scratch: nothing is written under secrets/' })
  expect(allowed).toMatchObject({ result: 'written' })
  expect(written).toEqual(['/repo/notes/q.txt'])
})

test('after next: a failed command sets the status line, a good one leaves it', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => (e.command.startsWith('false') ? { result: 'ran', isError: true } : { result: 'ran' }))

  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.tool.call({ tool: 'Bash', command: 'false --q4' })

  expect(statuses).toEqual(['scratch: false --q4 failed'])
})

test("answer a $ call: the plugin's own env.get hook answers its calls, and the engine is not asked", async ($, on) => {
  const askedBeneath: string[] = []
  on('env.get', ($, e) => {
    askedBeneath.push(e.name)
    return { value: '/real/home' }
  })

  const answer = await $.command.run(command('scratch-home'))

  expect(answer.text).toBe('HOME is /pretend/home')
  expect(askedBeneath).toEqual([])
})

test('state: each run counts up from the last value written', async $ => {
  await $.command.run(command('scratch-count'))
  await $.command.run(command('scratch-count'))
  const third = await $.command.run(command('scratch-count'))

  expect(third.text).toBe('count is 3')
})

// Observed on Claude Code 2.1.302, in this kit and in a headless session: a
// plugin's own hooks see a call it makes from inside a running hook, but not
// one from a timer that fires after the hook that set it has returned. That
// call still reaches the hooks beneath, as here the test's.
test("frames: a call from a timer set in session.start skips the plugin's own hooks", async ($, on) => {
  const clock = mock.clock(on)
  startSession(on)
  let beneath = 0
  on('session.cwd', () => {
    beneath += 1
    return { value: '/work' }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(20)
  const report = await $.command.run(command('scratch-frames'))

  expect(beneath).toBe(2)
  expect(report.text).toBe("seen by this plugin's own hook: command")
})
