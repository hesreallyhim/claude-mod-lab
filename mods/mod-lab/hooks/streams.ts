// Streams: the process.spawn probe, which keeps each piece of a child's
// output with when it arrived, and the brief of a stream's arrivals that the
// trace keeps for each model request.

import type { EngineInterface } from 'claude-code'

import type { LabStream } from '../types'
import type { ProbeArgs } from './args'

type Dollar = EngineInterface

/** How many slices of a stream's time its arrival counts are kept in. */
const SLICES = 32

export const SPAWN_CHOICES = [
  "sh -c 'for i in 1 2 3; do echo line $i; sleep 1; done'",
  'ping -c 4 127.0.0.1',
  "sh -c 'printf \"first half, \"; sleep 1; printf \"second half\\n\"'",
  "sh -c 'echo to stdout; echo to stderr >&2; exit 3'",
  "sh -c 'printf \"key sk-ant-api03-k9Qw2Xc7\"; sleep 1; printf \"Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd, made up\\n\"'",
] as const

/** The child for a choice; each argv is spelled out, so the validator and a reader see every command the probe can start. */
function spawnChoice($: Dollar, argv: string) {
  switch (argv) {
    case SPAWN_CHOICES[1]:
      return $.process.spawn({ argv: ['ping', '-c', '4', '127.0.0.1'] })
    case SPAWN_CHOICES[2]:
      return $.process.spawn({ argv: ['sh', '-c', 'printf "first half, "; sleep 1; printf "second half\\n"'] })
    case SPAWN_CHOICES[3]:
      return $.process.spawn({ argv: ['sh', '-c', 'echo to stdout; echo to stderr >&2; exit 3'] })
    case SPAWN_CHOICES[4]:
      // A made-up key in two writes, for the scrub challenge.
      return $.process.spawn({ argv: ['sh', '-c', 'printf "key sk-ant-api03-k9Qw2Xc7"; sleep 1; printf "Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd, made up\\n"'] })
    default:
      return $.process.spawn({ argv: ['sh', '-c', 'for i in 1 2 3; do echo line $i; sleep 1; done'] })
  }
}

export async function processSpawn($: Dollar, a: ProbeArgs) {
  const started = Date.now()
  const stream = spawnChoice($, String(a.argv))
  const chunks: { ms: number; stream: string; text: string }[] = []
  for await (const chunk of stream) chunks.push({ ms: Date.now() - started, stream: chunk.stream, text: chunk.text })
  return { ...(await stream.result), ms: Date.now() - started, chunks }
}

/** A stream in brief, from each chunk's kind and arrival in ms since the start. */
export function streamOf(arrivals: readonly { kind: string; ms: number }[], ms: number): LabStream {
  const kinds: LabStream['kinds'] = {}
  const slices = Array.from({ length: SLICES }, () => 0)
  for (const { kind, ms: at } of arrivals) {
    const seen = kinds[kind]
    kinds[kind] = seen === undefined ? { count: 1, first: at, last: at } : { count: seen.count + 1, first: seen.first, last: at }
    const slice = Math.min(SLICES - 1, Math.floor((at / Math.max(1, ms)) * SLICES))
    slices[slice] = (slices[slice] ?? 0) + 1
  }
  return { ms, first: arrivals[0]?.ms ?? null, kinds, arrivals: slices }
}

/** A stream in one line, for the trace. */
export function streamLine(stream: LabStream): string {
  const kinds = Object.entries(stream.kinds).map(([kind, seen]) => `${kind} ${seen.count}`)
  return stream.first === null ? 'no chunks' : `first chunk after ${stream.first} ms; ${kinds.join(', ')}`
}
