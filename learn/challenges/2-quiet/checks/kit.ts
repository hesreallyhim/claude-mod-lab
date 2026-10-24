// Shared by the quiet checks; not a check itself.

import type { CommandRunInput, On } from 'claude-code'

export const HOUR_MS = 60 * 60 * 1000

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** Answers the session's start and the command registration, as the engine would. */
export function answerStart(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

/** Records each toast that reaches the screen, which is what gets past every plugin's hooks. */
export function screen(on: On): string[] {
  const shown: string[] = []
  on('ui.toast', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return shown
}
