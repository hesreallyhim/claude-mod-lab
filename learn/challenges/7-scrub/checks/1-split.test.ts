import { expect, test } from 'claude-code/testing'

import { child, KEY, out, readBy, run, runner, textOn } from './kit'

test('a key the child wrote in two parts reaches the caller as [redacted]', { plugins: [runner] }, async ($, on) => {
  const cut = KEY.length / 2
  child(on, [out(`token ${KEY.slice(0, cut)}`), out(`${KEY.slice(cut)} is set\n`)])

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe('token [redacted] is set\n')
})

test('so does a key inside one piece, and every key on every line', { plugins: [runner] }, async ($, on) => {
  child(on, [out(`first ${KEY}\nthen ${KEY} and ${KEY}\n`)])

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe('first [redacted]\nthen [redacted] and [redacted]\n')
})
