import { expect, test } from 'claude-code/testing'

import { edit, editor, lab, movingLeft, typing } from './kit'

function ghostOf(box: { decorations?: readonly { virtualText?: string }[] }): string | undefined {
  return box.decorations?.find(run => run.virtualText !== undefined)?.virtualText
}

test('the rest of the first probe id the word starts is drawn after the caret', { plugins: [lab] }, async ($, on) => {
  editor(on)

  const box = await edit($, typing('/mod-lab session.c'))

  expect(ghostOf(box)).toBe('wd')
  expect(box.decorations?.find(run => run.virtualText !== undefined)).toMatchObject({ start: box.text.length, end: box.text.length })
})

test('no ghost text away from the end, for a whole id, or when no id matches', { plugins: [lab] }, async ($, on) => {
  editor(on)

  expect(ghostOf(await edit($, movingLeft('/mod-lab session.c')))).toBe(undefined)
  expect(ghostOf(await edit($, typing('/mod-lab session.cwd')))).toBe(undefined)
  expect(ghostOf(await edit($, typing('/mod-lab zz')))).toBe(undefined)
})
