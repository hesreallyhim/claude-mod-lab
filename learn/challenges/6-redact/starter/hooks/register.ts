// redact: a challenge. ../README.md says what to do; the checks in
// learn/challenges/6-redact/checks say when it is done.

import type { Register } from 'claude-code'

const KEY = /sk-[A-Za-z0-9_-]{20,}/g

export const register: Register = on => {
  // Takes keys out of what the person types, before the model reads it.
  on('prompt.submit', ($, e, next) => next({ ...e, text: e.text.replace(KEY, '[redacted]') }))
}
