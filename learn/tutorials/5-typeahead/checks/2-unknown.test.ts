import { expect, test } from 'claude-code/testing'

import { edit, editor, lab, runsAt, typing } from './kit'

const WORD = '/mod-lab '.length

test('a word that no probe id starts with is underlined', { plugins: [lab] }, async ($, on) => {
  editor(on)

  const box = await edit($, typing('/mod-lab fs.raed'))

  expect(runsAt(box, WORD)).toContainEqual(expect.objectContaining({ end: box.text.length, underline: true }))
})

test('a probe id, the start of one, and a lab command with no dot are not', { plugins: [lab] }, async ($, on) => {
  editor(on)

  for (const text of ['/mod-lab fs.read', '/mod-lab session.c', '/mod-lab list']) {
    const box = await edit($, typing(text))
    expect(runsAt(box, WORD).some(run => run.underline === true)).toBe(false)
  }
})
