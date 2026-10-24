import { expect, test } from 'claude-code/testing'

import { edit, editor, lab, runsAt, typing } from './kit'

test('typing /mod-lab paints it bold', { plugins: [lab] }, async ($, on) => {
  editor(on)

  const box = await edit($, typing('/mod-lab'))

  expect(box.text).toBe('/mod-lab')
  expect(runsAt(box, 0).some(run => run.end === 8 && run.bold === true)).toBe(true)
})

test("the box stays the editor's, and the runs another plugin painted stay", { plugins: [lab] }, async ($, on) => {
  const theirs = { start: 0, end: 1, italic: true }
  editor(on, [theirs])

  const box = await edit($, typing('/mod-lab x'))

  expect(box).toMatchObject({ text: '/mod-lab x', cursor: 10 })
  expect(box.decorations).toContainEqual(theirs)
  expect(runsAt(box, 0).some(run => run.bold === true)).toBe(true)
})

test('a box that does not start with /mod-lab is left unpainted', { plugins: [lab] }, async ($, on) => {
  editor(on)

  const box = await edit($, typing('see /mod-lab'))

  expect(box.decorations ?? []).toEqual([])
})
