// Shared by the redact checks; not a check itself.

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

/** Made-up keys of the three kinds the mod redacts. */
export const KEYS = {
  anthropic: 'sk-ant-api03-k9Qw2Xc7Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd',
  github: 'ghp_k9Qw2Xc7Vb1Nm4Lp8Rt5Yz3Hj6Gf0DdSaEeF',
  aws: 'AKIAK9QW2XC7VB1NM4LP',
}

/** The conversation beneath the mod: what it stored, in order. */
export function conversation(on: On) {
  const session = mock.session(on)
  return () => session.appended().map(row => row.message)
}

/** A row on its way to being stored, as the engine raises it. */
export function row(door: string, content: unknown[], type = 'user') {
  return { message: { type, content }, door, origin: { kind: 'composer' }, uuid: `uuid-${door}` } as never
}

/** Everything a stored row says, its blocks' texts and tool results' contents, as one string. */
export function said(message: { content: readonly unknown[] }): string {
  return JSON.stringify(message.content)
}
