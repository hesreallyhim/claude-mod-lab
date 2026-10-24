import { expect, test } from 'claude-code/testing'

import { conversation, KEYS, row, said } from './kit'

test("a key in a tool's result is redacted there, and the result still answers its call", async ($, on) => {
  const stored = conversation(on)

  await $.session.append(row('tool-result', [{ type: 'tool_result', tool_use_id: 'toolu_r1', content: `AWS_KEY=${KEYS.aws}\nREGION=eu-west-1` }]))
  await $.session.append(row('tool-result', [{ type: 'tool_result', tool_use_id: 'toolu_r2', content: [{ type: 'text', text: `token: ${KEYS.github}` }] }]))

  expect(said(stored()[0]!)).toContain('AWS_KEY=[redacted]\\nREGION=eu-west-1')
  expect(said(stored()[1]!)).toContain('token: [redacted]')
  expect(stored().map(message => (message.content[0] as { tool_use_id?: string }).tool_use_id)).toEqual(['toolu_r1', 'toolu_r2'])
})

test("a key in a hook's context or in the model's own reply is redacted too", async ($, on) => {
  const stored = conversation(on)

  await $.session.append(row('hook-context', [{ type: 'text', text: `env says ${KEYS.anthropic}` }]))
  await $.session.append(row('response', [{ type: 'text', text: `I used ${KEYS.aws}.` }], 'assistant'))

  expect(stored().map(said).join(' ')).not.toMatch(/sk-ant-|AKIA/)
})
