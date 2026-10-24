// Shared by the only-mine checks; not a check itself.

import type { CommandRunInput, On } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** Another plugin, loaded beside yours: its /neighbor-cwd answers what its own $.session.cwd() got. */
export const neighbor: Plugin = {
  name: 'neighbor',
  register(on) {
    on('command.run', { command: 'neighbor-cwd' }, async $ => ({ text: await $.session.cwd() }))
  },
}

export async function neighborsCwd($: Engine): Promise<string> {
  return (await $.command.run(slash('neighbor-cwd'))).text ?? ''
}

/** Stands for the engine's answer to session.cwd, counting the calls that reach it. */
export function realCwd(on: On, cwd: string): { asked: number } {
  const count = { asked: 0 }
  on('session.cwd', () => {
    count.asked += 1
    return { value: cwd }
  })
  return count
}
