// The explorer server's state: the connected session, the jobs the page
// queued for it, the runs, trace rows and taps it reported, the values of
// the lab's state it mirrors, and a bridge refused for its protocol number.
// No HTTP here; the server maps requests onto these calls.

import { randomUUID } from 'node:crypto'

/**
 * The bridge protocol's number: a hello with another is refused. Raise it
 * here and in mods/mod-lab-bridge/hooks/bridge.ts (PROTOCOL), in one commit,
 * when a change to the requests or their bodies would break the other side.
 */
export const BRIDGE_PROTOCOL = 1

const MAX_RUNS = 300
const MAX_TRACES = 1000
const MAX_TAPS = 500
const NOT_CONNECTED = 'no session is connected: start Claude Code with both mods loaded'
// What follows /mod-lab is a line typed by hand; anything this long is a mistake.
const MAX_COMMAND_CHARS = 2_000
const MIRROR_KEY = /^[a-z][A-Za-z]{0,31}$/
const MAX_MIRRORED = 16
const VERSION = /^\d+\.\d+\.\d+$/

/** What a bridge with another protocol number is told, and the page shows: the two numbers and which side to update. */
export function protocolMessage(theirs) {
  const speaks = typeof theirs === 'number' ? `speaks bridge protocol ${theirs}` : 'sends no bridge protocol number'
  // claude plugin update does not follow dependencies, so the bridge's update alone would leave mod-lab behind.
  const fix =
    typeof theirs === 'number' && theirs > BRIDGE_PROTOCOL
      ? 'update the explorer with npx claude-mod-lab@latest'
      : 'update the lab\'s plugins, each with its own claude plugin update, as the README\'s "Updating" section lists them, then run /reload-plugins in the session'
  return `the session's mod-lab-bridge ${speaks} and this explorer speaks ${BRIDGE_PROTOCOL}: ${fix}`
}

/** The hello's engine: the build's version and the surfaces it draws on; null from a bridge that sends none. */
function engineOf(engine) {
  if (typeof engine?.version !== 'string') return null
  const surfaces = Array.isArray(engine.surfaces) ? engine.surfaces.filter(surface => typeof surface === 'string') : []
  return { version: engine.version, surfaces }
}

/** A table of compat.json's: the entries shaped { since, uses }, the rest left out. */
function needsOf(table) {
  if (table === null || typeof table !== 'object') return {}
  return Object.fromEntries(
    Object.entries(table).filter(
      ([, need]) =>
        typeof need?.since === 'string' &&
        VERSION.test(need.since) &&
        Array.isArray(need.uses) &&
        need.uses.every(use => typeof use === 'string'),
    ),
  )
}

/** The bridge's compat.json as mods/mod-lab/hooks/compat.ts reads it; null without a floor and tested-through version. */
export function compatOf(compat) {
  const { floor, testedThrough, plugins, capabilities } = compat ?? {}
  if (typeof floor !== 'string' || !VERSION.test(floor)) return null
  if (typeof testedThrough !== 'string' || !VERSION.test(testedThrough)) return null
  return { floor, testedThrough, plugins: needsOf(plugins), capabilities: needsOf(capabilities) }
}

export function createHub({ now = Date.now, staleMs = 5_000, jobTimeoutMs = 60_000 } = {}) {
  let session = null
  // The latest bridge refused for its protocol number, while it keeps saying hello.
  let mismatch = null
  const jobs = new Map()
  let runs = []
  let traces = []
  let taps = []
  // Values of the lab's state the bridge mirrors whole (intercepts, spend...), by key.
  let mirrored = {}
  const listeners = new Set()

  const emit = (type, data) => {
    for (const listener of listeners) listener(type, data)
  }

  const isConnected = () => session !== null && now() - session.lastSeen <= staleMs

  const sessionView = () =>
    session === null
      ? null
      : {
          client: session.client,
          facts: session.facts,
          plugin: session.plugin,
          lab: session.lab,
          engine: session.engine,
          compat: session.compat,
          probes: session.probes,
          interceptable: session.interceptable,
          isConnected: isConnected(),
          lastSeen: session.lastSeen,
        }

  const jobView = job => ({
    id: job.id,
    kind: job.kind,
    probe: job.probe ?? null,
    args: job.args ?? null,
    text: job.text ?? null,
    status: job.status,
    queuedAt: job.queuedAt,
    error: job.error ?? null,
    answer: job.answer ?? null,
  })

  function seen(client) {
    if (session === null || session.client !== client) return false
    session.lastSeen = now()
    return true
  }

  /** Expires jobs a session took and never answered, as when it reloaded mid-run. */
  function sweep() {
    for (const job of jobs.values()) {
      if (job.status === 'sent' && now() - job.sentAt > jobTimeoutMs) {
        job.status = 'lost'
        job.error = 'the session took this job and never answered it'
        emit('job', jobView(job))
      }
    }
  }

  /** Drops the refusal once that bridge has stopped saying hello: it greets again every few seconds while it runs. */
  function expireMismatch() {
    if (mismatch !== null && now() - mismatch.at > staleMs * 2) {
      mismatch = null
      emit('mismatch', null)
    }
  }

  /** Refuses a bridge with another protocol number, and keeps the refusal for the page. */
  function refuseProtocol(theirs) {
    const protocol = typeof theirs === 'number' ? theirs : null
    const isNew = mismatch?.protocol !== protocol
    mismatch = { protocol, expected: BRIDGE_PROTOCOL, message: protocolMessage(protocol), at: now() }
    if (isNew) emit('mismatch', mismatch)
    return { error: mismatch.message }
  }

  function queue(fields) {
    const job = { id: randomUUID(), ...fields, status: 'queued', queuedAt: now() }
    jobs.set(job.id, job)
    emit('job', jobView(job))
    return { job: job.id }
  }

  return {
    /**
     * Greets a session and answers its client id. A bridge with another
     * protocol number is refused, with a message naming the side to update.
     * The explorer serves one session: another is refused while the one it
     * serves still polls, and takes its place once that one goes stale.
     */
    hello(body) {
      if (body?.protocol !== BRIDGE_PROTOCOL) return refuseProtocol(body?.protocol)
      const facts = body?.session ?? {}
      const isSameSession = session !== null && session.facts.id === facts.id
      if (!isSameSession && isConnected()) {
        return {
          error: `the explorer is serving session ${String(session.facts.id).slice(0, 8)}; it takes another once that one stops`,
        }
      }
      if (!isSameSession) {
        runs = []
        traces = []
        taps = []
        mirrored = {}
      }
      session = {
        client: randomUUID(),
        facts,
        plugin: body?.plugin ?? null,
        lab: body?.lab ?? null,
        engine: engineOf(body?.engine),
        compat: compatOf(body?.compat),
        probes: Array.isArray(body?.probes) ? body.probes : [],
        interceptable: Array.isArray(body?.interceptable) ? body.interceptable : [],
        lastSeen: now(),
      }
      emit('session', sessionView())
      if (mismatch !== null) {
        mismatch = null
        emit('mismatch', null)
      }
      return { client: session.client }
    },

    /** The next queued job for this client, or null; undefined when the client is not the current one. */
    next(client) {
      if (!seen(client)) return undefined
      sweep()
      const job = [...jobs.values()].find(one => one.status === 'queued')
      if (job === undefined) return null
      job.status = 'sent'
      job.sentAt = now()
      emit('job', jobView(job))
      if (job.kind === 'command') return { id: job.id, kind: 'command', text: job.text }
      if (job.kind === 'reload') return { id: job.id, kind: 'reload' }
      return { id: job.id, probe: job.probe, args: job.args }
    },

    addRuns(client, list, jobId) {
      if (!seen(client)) return false
      for (const run of Array.isArray(list) ? list : []) {
        const isKnown = run.seq > 0 && runs.some(one => one.seq === run.seq)
        if (!isKnown) {
          runs = [...runs, run].slice(-MAX_RUNS)
          emit('run', run)
        }
      }
      const job = jobId === null || jobId === undefined ? undefined : jobs.get(jobId)
      if (job !== undefined) {
        job.status = 'done'
        job.run = list[0] ?? null
        emit('job', { ...jobView(job), run: job.run })
      }
      return true
    },

    addTraces(client, rows) {
      if (!seen(client)) return false
      const fresh = (Array.isArray(rows) ? rows : []).filter(row => !traces.some(one => one.seq === row.seq))
      traces = [...traces, ...fresh].slice(-MAX_TRACES)
      if (fresh.length > 0) emit('traces', fresh)
      return true
    },

    addTaps(client, list) {
      if (!seen(client)) return false
      const fresh = (Array.isArray(list) ? list : []).filter(tap => !taps.some(one => one.seq === tap.seq))
      taps = [...taps, ...fresh].slice(-MAX_TAPS)
      if (fresh.length > 0) emit('taps', fresh)
      return true
    },

    /**
     * A value of the lab's state, which the bridge sends whole whenever it
     * changes. false for an unknown client; null for a key it does not take.
     */
    mirror(client, key, value) {
      if (!seen(client)) return false
      if (
        typeof key !== 'string' ||
        !MIRROR_KEY.test(key) ||
        (!(key in mirrored) && Object.keys(mirrored).length >= MAX_MIRRORED)
      )
        return null
      mirrored = { ...mirrored, [key]: value }
      emit('mirror', { key, value })
      return true
    },

    /** The text that answers a command job. */
    answer(client, jobId, text) {
      if (!seen(client)) return false
      const job = jobs.get(jobId)
      if (job !== undefined) {
        job.status = 'done'
        job.answer = String(text ?? '')
        emit('job', jobView(job))
      }
      return true
    },

    /** Queues a run for the session; refused while none is connected, so the page can say so at once. */
    enqueue(probe, args) {
      if (!isConnected()) return { error: NOT_CONNECTED }
      const known = session.probes.length === 0 || session.probes.some(one => one.id === probe)
      if (!known) return { error: `the session has no probe named ${probe}` }
      return queue({ kind: 'probe', probe, args: args ?? {} })
    },

    /** Queues what follows `/mod-lab` for the session, which answers the text the command shows. */
    enqueueCommand(text) {
      if (!isConnected()) return { error: NOT_CONNECTED }
      const line = String(text ?? '').trim()
      if (line.length > MAX_COMMAND_CHARS) return { error: `a command is at most ${MAX_COMMAND_CHARS} characters` }
      return queue({ kind: 'command', text: line })
    },

    /** Queues /reload-plugins for the session, so it loads a plugin added or removed since it started; answered like a command. */
    enqueueReload() {
      if (!isConnected()) return { error: NOT_CONNECTED }
      return queue({ kind: 'reload' })
    },

    /** Resolves to the job once the session answered it or lost it, or null after `ms`. */
    settled(id, ms) {
      return new Promise(done => {
        const isOver = job => job.status === 'done' || job.status === 'lost'
        const known = jobs.get(id)
        if (known === undefined || isOver(known)) return done(known === undefined ? null : jobView(known))
        const listener = (type, data) => {
          if (type === 'job' && data.id === id && isOver(data)) finish(data)
        }
        const timer = setTimeout(() => finish(null), ms)
        const finish = job => {
          listeners.delete(listener)
          clearTimeout(timer)
          done(job)
        }
        listeners.add(listener)
      })
    },

    snapshot() {
      sweep()
      expireMismatch()
      return {
        session: sessionView(),
        mismatch,
        runs,
        traces,
        taps,
        mirror: mirrored,
        jobs: [...jobs.values()].map(jobView),
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
