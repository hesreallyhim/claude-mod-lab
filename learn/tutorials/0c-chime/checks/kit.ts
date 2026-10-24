// Shared by the chime checks; not a check itself. The checks' own hooks sit
// beneath the mod and stand for the engine: they end a turn of Claude's as
// the engine would, and play and speak by writing down what they were asked
// to, so a check can hear what the mod did.

import type { On, TurnCompleteInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export function ears($: Engine, on: On) {
  const clock = mock.clock(on, { now: 0 })
  /** The asset of each clip played, in order. */
  const played: string[] = []
  /** Each text said, in order. */
  const said: string[] = []
  on('audio.play', ($, e) => {
    played.push('asset' in e.clip ? String(e.clip.asset) : 'another clip')
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    said.push(e.text)
    return { value: { via: 'system' as const } }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  /** One of Claude's turns ends after `seconds`, with `answer`; an agent's when `agentId` is given. */
  async function finish(seconds: number, answer = 'Done.', agentId?: string): Promise<void> {
    const input = { answer, durationMs: seconds * 1000, isAborted: false, reason: 'answer', turnId: 'turn-1' }
    await $.turn.complete((agentId === undefined ? input : { ...input, agentId }) as TurnCompleteInput)
    await clock.settle()
  }

  return { played, said, finish }
}
