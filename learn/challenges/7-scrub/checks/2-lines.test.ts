import { expect, test } from 'claude-code/testing'

import { child, out, readBy, run, runner, textOn } from './kit'

test('a whole line reaches the caller before the next piece is asked for', { plugins: [runner] }, async ($, on) => {
  const happened: string[] = []
  child(on, [out('line-l1\nline-l2 starts'), out(' and ends\n')], 0, () => happened.push('the next piece was asked for'))
  on('ui.toast', ($, e) => {
    happened.push(`the caller read ${JSON.stringify(e.text)}`)
    return { value: undefined }
  })

  await $.command.run(run('toast'))

  expect(happened[0]).toBe('the caller read "line-l1\\n"')
})

test('a line split across pieces arrives whole, and every piece passed on ends a line', { plugins: [runner] }, async ($, on) => {
  const pieces = [out('one\ntw'), out('o\nthr'), out('ee\n')]
  child(on, pieces)

  const { read } = readBy(await $.command.run(run()))

  expect(textOn(read, 'stdout')).toBe(pieces.map(piece => piece.text).join(''))
  expect(read.every(piece => piece.text.endsWith('\n'))).toBe(true)
})
