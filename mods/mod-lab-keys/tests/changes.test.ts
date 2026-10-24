import { expect, test } from 'claude-code/testing'
import type { PromptChangeInput, PromptChangeResult } from 'claude-code'

import type { KeyChanges } from '../types'

// The test's `$` raises prompt.change, though its type does not list it.
type PromptBoxEvents = { prompt: { change: (e: PromptChangeInput) => Promise<PromptChangeResult> } }

function change($: unknown, e: PromptChangeInput): Promise<PromptChangeResult> {
  return ($ as PromptBoxEvents).prompt.change(e)
}

test('each change that came another way is kept, numbered, with who made it and its lengths, never its text', async ($, on) => {
  on('prompt.change', ($, e) => ({ text: e.text }))
  const kept: KeyChanges[] = []
  on('state.set', { plugin: 'mod-lab-keys', key: 'changes' }, ($, e, next) => {
    kept.push(e.value)
    return next(e)
  })
  const recalled = 'recalled-h1'
  const filled = 'filled-f1 longer'

  const box = await change($, { text: recalled, cursor: recalled.length, origin: { kind: 'history' } })
  await change($, { text: filled, cursor: 4, origin: { kind: 'plugin', name: 'filler-p1' } })

  expect(box).toEqual({ text: recalled })
  expect(kept.at(-1)?.rows.map(({ seq, origin, length, cursor }) => ({ seq, origin, length, cursor }))).toEqual([
    { seq: 1, origin: 'history', length: recalled.length, cursor: recalled.length },
    { seq: 2, origin: 'plugin filler-p1', length: filled.length, cursor: 4 },
  ])
  expect(JSON.stringify(kept)).not.toContain('recalled-h1')
  expect(JSON.stringify(kept)).not.toContain('filled-f1')
})
