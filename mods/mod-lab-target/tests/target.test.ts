import { expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

/** Another plugin, whose /exists and /read make the calls /mod-lab verify makes, and answer what came back. */
const caller: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'exists' }, async ($, e) => ({ text: String(await $.fs.exists(e.args)) }))
    on('command.run', { command: 'read' }, async ($, e) => ({ text: await $.fs.read(e.args) }))
  },
}

const slash = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }) as const

test("a failure before next is skipped, a caught one answers its handler's value, and one after next keeps next's", { plugins: [caller] }, async ($, on) => {
  on('fs.exists', () => ({ value: false }))

  const answers = []
  for (const mode of ['skipped', 'caught', 'kept']) answers.push((await $.command.run(slash('exists', `/dev/null/mod-lab-target/${mode}`))).text)

  expect(answers).toEqual(['false', 'true', 'false'])
})

test('any other path passes untouched', { plugins: [caller] }, async ($, on) => {
  on('fs.exists', ($, e) => ({ value: e.path === '/somewhere/real' }))

  expect((await $.command.run(slash('exists', '/somewhere/real'))).text).toBe('true')
})

test("a timer's call after the hook returned does not reach the plugin's own hook, and the report says so", { plugins: [caller] }, async ($, on) => {
  const clock = mock.clock(on)
  const seen: string[] = []
  on('fs.exists', ($, e) => {
    seen.push(e.path)
    return { value: false }
  })

  await $.command.run(slash('exists', '/dev/null/mod-lab-target/arm-timer'))
  await clock.advance(50)
  const report = await $.command.run(slash('read', '/dev/null/mod-lab-target/report'))

  expect(seen).toContain('/dev/null/mod-lab-target/from-timer')
  expect(JSON.parse(report.text ?? '{}')).toEqual({ isTimerCallSeen: false })
})
