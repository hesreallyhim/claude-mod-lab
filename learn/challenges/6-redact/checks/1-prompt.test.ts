import { expect, test } from 'claude-code/testing'

import { conversation, KEYS, row, said } from './kit'

test('a key the person typed is stored as [redacted], the words around it kept', async ($, on) => {
  const stored = conversation(on)

  await $.session.append(row('prompt', [{ type: 'text', text: `deploy with ${KEYS.anthropic} please` }]))

  expect(said(stored()[0]!)).not.toContain(KEYS.anthropic)
  expect(said(stored()[0]!)).toContain('deploy with [redacted] please')
})

test('each kind of key is redacted, however many a row carries', async ($, on) => {
  const stored = conversation(on)

  await $.session.append(row('prompt', [{ type: 'text', text: `${KEYS.github} and ${KEYS.aws}, then ${KEYS.anthropic}` }]))

  expect(said(stored()[0]!)).toContain('[redacted] and [redacted], then [redacted]')
})
