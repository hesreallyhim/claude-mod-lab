import { expect, test } from 'claude-code/testing'

import { child, err, out, readBy, run, runner, textOn } from './kit'

test('stdout and stderr stay apart: a line on one is never joined to text from the other', { plugins: [runner] }, async ($, on) => {
  child(on, [out('build '), err('warning-w1: slow\n'), out('done-d1\n')])

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe('build done-d1\n')
  expect(textOn(read, 'stderr')).toBe('warning-w1: slow\n')
})

test('a last line with no newline still arrives, when the child ends', { plugins: [runner] }, async ($, on) => {
  child(on, [out('almost-a1\nthe end-e1')])

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe('almost-a1\nthe end-e1')
})

test("text with no key passes exactly, things that only look like a key's start included", { plugins: [runner] }, async ($, on) => {
  const text = 'sk-short, ghp_ and AKIA1 are not keys\n'
  child(on, [out(text)])

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe(text)
})

test('how the child ended reaches the caller', { plugins: [runner] }, async ($, on) => {
  child(on, [out('failed-f1\n')], 3)

  const { ended } = readBy(await $.command.run(run()))

  expect(ended.code).toBe(3)
})
