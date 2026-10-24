export type LabJson = null | boolean | number | string | LabJson[] | { [key: string]: LabJson }

export type LabArgValue = string | number | boolean

export type LabArgText = { [name: string]: string }

/** What running a probe can do beyond reading. */
export type LabEffect = 'read' | 'ui' | 'write' | 'network' | 'spend' | 'dialog' | 'tool'

export type LabParam = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'choice'
  default: LabArgValue
  options?: readonly string[]
  description: string
}

export type LabProbe = {
  id: string
  noun: string
  description: string
  effect: LabEffect
  params: readonly LabParam[]
  /** The probe function's own source, as the engine compiled it. */
  source: string
  /** The `$` methods its source calls, in order of first appearance. */
  calls: readonly string[]
}

/**
 * One link of a dispatch's chain, as `next.trace` reported it. `received` is
 * the input that link saw, kept only when it differs from the caller's: a
 * hook above it rewrote `e`.
 */
export type LabLink = {
  plugin: string
  tier: string
  outcome: string
  ms: number
  received?: LabJson
  /** On a streaming event, how many chunks the link yielded up. */
  chunks?: number
}

/** One event a `$` call raised while a probe ran. */
export type LabDispatch = {
  event: string
  received: LabJson
  returned: LabJson
  chain: LabLink[]
  /** The lab's own intercept on the event, when one acted on this dispatch. */
  intercepted?: LabInterceptBehavior
}

/** Where a run was asked for; `plugin` is another plugin's `$.lab.run`, the explorer bridge's aside. */
export type LabRunSource = 'pane' | 'command' | 'tool' | 'explorer' | 'plugin'

export type LabRun = {
  seq: number
  probe: string
  args: { [name: string]: LabArgValue }
  from: LabRunSource
  ok: boolean
  value: LabJson
  error: string | null
  ms: number
  at: number
  dispatches: LabDispatch[]
}

/** A stream in brief: when its first chunk came, each kind's count, first and last arrival, and arrivals per slice of its time. */
export type LabStream = {
  ms: number
  /** Milliseconds from the start to the first chunk; null when none came. */
  first: number | null
  kinds: { [kind: string]: { count: number; first: number; last: number } }
  /** Chunks per equal slice of `ms`, oldest first. */
  arrivals: number[]
}

export type LabTraceRow = {
  seq: number
  event: string
  at: number
  ms: number
  summary: string
  input: LabJson
  result: LabJson
  chain: LabLink[]
  /** A model request's chunks as they arrived. */
  stream?: LabStream
}

export type LabView = 'probes' | 'trace' | 'runs' | 'intercept' | 'help'

/** Where the pane's Help tab is: the group of commands it shows, and the command whose other forms are open, if any. */
export type LabHelpView = { group: string; command: string | null }

/**
 * What the lab's hook on an event does with the calls it intercepts: records
 * them and passes them on (`watch`), refuses them, answers them itself with
 * `value`, passes them on with `value` merged into `e` (`rewrite`), or waits
 * `ms` first (`delay`), which counts against the hook's budget.
 */
export type LabInterceptBehavior = 'watch' | 'refuse' | 'answer' | 'rewrite' | 'delay'

/** Whose calls an intercept acts on: the lab's own probes, every other plugin's, or both. */
export type LabInterceptScope = 'lab' | 'others' | 'all'

export type LabIntercept = {
  event: string
  behavior: LabInterceptBehavior
  scope: LabInterceptScope
  /** For `answer`, the value; for `rewrite`, the fields merged into `e`. */
  value: LabJson
  /** For `delay`. */
  ms: number
  since: number
  /** When it lapses; null for one that only watches or only touches the lab's calls. */
  until: number | null
}

/** The intercept form as last edited, so a redraw keeps it. */
export type LabInterceptDraft = {
  event: string
  behavior: LabInterceptBehavior
  scope: LabInterceptScope
  value: string
  ms: string
}

/** One call an intercept acted on. */
export type LabTap = {
  seq: number
  at: number
  event: string
  /** The plugin that made the call. */
  origin: string
  behavior: LabInterceptBehavior
  received: LabJson
  returned: LabJson
  chain: LabLink[]
  ms: number
}

export type LabRunInput = {
  probe: string
  args?: { [name: string]: LabArgValue }
  from?: LabRunSource
}

/** One part of what the model reads, as the ledger keeps it: how often, how long the newest was, and its start. */
export type LabLedgerEntry = { count: number; chars: number; at: number; preview: string }

/** A tool as the engine first described it to the model: who provides it, whether it waits behind ToolSearch, and its name and description's length. */
export type LabLedgerTool = { provider: string; isDeferred: boolean; chars: number }

/**
 * What the lab saw added to the model's input: the lines each plugin added
 * to the latest prompt's context, the blocks plugins added to the first
 * message's context, the messages the engine injected, by source, and each
 * tool as it was described.
 */
export type LabLedger = {
  /** Prompts seen at prompt.submit. */
  prompts: number
  promptContext: { [plugin: string]: LabLedgerEntry }
  contextBlocks: { [plugin: string]: LabLedgerEntry }
  attachments: { [source: string]: LabLedgerEntry }
  tools: { [tool: string]: LabLedgerTool }
}

/** Token counts of one model call, as its usage gave them. */
export type LabUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** A model call one of the session's plugins made, as the lab's hook on it saw it settle. */
export type LabSpendCall = {
  seq: number
  at: number
  /** `model.complete`, `model.fork` or `model.classify`. */
  event: string
  /** The plugin that made the call. */
  plugin: string
  /** The model asked for, where the call names one. */
  model: string | null
  /** Whether the call reached the engine, and so the model: false when a hook answered it, as free mode does. */
  isSent: boolean
  isAnswered: boolean
  /** Null where the result carries none (`model.classify` answers a label). */
  usage: LabUsage | null
  ms: number
}
export type LabSpendTotal = LabUsage & { calls: number; sent: number }
/** The session's model calls by plugin: the newest calls, and totals that outlast them. */
export type LabSpend = { calls: LabSpendCall[]; totals: { [plugin: string]: LabSpendTotal } }
/** An agent type the lab registered, as it was given. */
export type LabAgentType = { agent: string; description: string; model: string | null; tools: string[]; at: number }
/** An agent spawned in the session, by the model or a plugin, as the lab saw it start and end. */
export type LabAgentRun = {
  agentId: string
  /** The type it runs as: a registered `<plugin>:<name>`, or a built-in such as `general-purpose`. */
  type: string
  /** Who spawned it: a plugin's name, or `engine` for the model's own Agent tool. */
  by: string
  description: string
  prompt: string
  /** What it runs on, as the spawn answered. */
  model: string | null
  /** Whether the lab's route sent it to another model than the one asked for. */
  isRouted: boolean
  at: number
  status: 'running' | 'done' | 'aborted'
  answer: string | null
  durationMs: number | null
}
/**
 * The lab's agents: the types it registered, the agents spawned in the
 * session, the types it hides from the model, and the model it sends every
 * spawn to, if any.
 */
export type LabAgents = { types: LabAgentType[]; runs: LabAgentRun[]; hidden: string[]; route: string | null }
/** Who a stored row is for, as its type and door say: the model alone, the person alone, or both. */
export type LabReader = 'model' | 'person' | 'both'
/** A row the conversation kept, in brief, as the lab's hook on session.append saw it stored. */
export type LabRow = {
  seq: number
  at: number
  /** How it came in: prompt, command, response, tool-result, hook-context, attachment, note... */
  door: string
  /** Who or what it came from: the composer, a plugin, the model, a tool. */
  origin: string
  type: string
  /** An attachment's type or a notice's subtype, as the row's `name`; null on a user or assistant row. */
  name: string | null
  /** The row's id, the same in the transcript file, where the explorer reads its record. */
  uuid: string | null
  reader: LabReader
  agentId: string | null
  /** The kinds of its content blocks, in order. */
  blocks: string[]
  /** The length of the row's text: text and thinking blocks, a tool call's name and input, a tool result's content. */
  chars: number
  preview: string
  /** A hook beneath the lab changed it on its way to being stored. */
  isRewritten: boolean
}
export type LabRows = { rows: LabRow[] }
/** One message of a compaction, in brief. */
export type LabCompactMessage = {
  role: 'user' | 'assistant'
  /** Its text, tool inputs and tool results together. */
  chars: number
  tools: number
  results: number
  preview: string
  /** Before: the compaction kept it. After: it is one of the messages before, not one built for the compaction. */
  isKept: boolean
}
/** A compaction, as the lab's hook on session.compact saw it pass. */
export type LabCompaction = {
  at: number
  trigger: string
  agentId: string | null
  /** Who answered it: `mod-lab` for the lab's compactor, `engine`, or a plugin beneath the lab. */
  by: string
  before: LabCompactMessage[]
  /** Null when it was skipped. */
  after: LabCompactMessage[] | null
  /** The conversation's size in tokens before, by the measure `sizedBy` names. */
  tokensBefore: number | null
  /** Its size after; with `sizedBy` `request`, filled in by the next request. */
  tokensAfter: number | null
  /**
   * `engine`: the counts the compaction recorded. `request`: a request's whole
   * input, the system prompt and tools included, the last before and the next after.
   */
  sizedBy: 'engine' | 'request' | null
  /** What the summarizer's own request read and wrote, when the engine made one. */
  summarizer: { input: number; output: number } | null
  skipped: string | null
}
/** The lab's compactor: how many of the last messages it keeps while on (null: off), and the session's compactions. */
export type LabCompactor = { keep: number | null; compactions: LabCompaction[] }
/**
 * One change to the prompt box, in brief: an edit the person made
 * (`prompt.edit`) or a change that came another way (`prompt.change`, as
 * mod-lab-keys kept it). Lengths and offsets only: the draft is not kept.
 */
export type LabKey = {
  seq: number
  at: number
  kind: 'edit' | 'change'
  /** `composer` for an edit; for a change `history`, `clear`, `undo`, `plugin <name>`, `app` or `engine`. */
  origin: string
  /** The key that made an edit, by name with its modifiers; `text` for a character typed plain; null for a paste or a burst. */
  key: string | null
  /** Where an edit's splice began and ended in the draft before, and how many characters went in. */
  splice: { start: number; end: number; inserted: number } | null
  /** The draft's length before an edit; null for a change. */
  before: number | null
  after: number
  cursor: number
  /** Runs painted over the box, as the chain beneath the lab answered. */
  decorations: number
  /** The box the chain answered differs from the splice applied to the draft: a hook beneath changed it. */
  isRewritten: boolean
}
export type LabKeys = {
  rows: LabKey[]
  /** The newest of mod-lab-keys' change rows the log holds, by that plugin's `seq`; absent before the first. */
  changeSeq?: number
}
/** A /config row as `$.config.list()` answers it, its owner in words and a list value joined. */
export type LabConfigRow = {
  key: string
  label: string
  description: string | null
  kind: 'boolean' | 'choice' | 'text' | 'number'
  value: string | number | boolean
  options: string[] | null
  /** The plugin, or `engine`, and its tier. */
  provider: string
  isLocked: boolean
}
/**
 * What follows `/mod-lab`, as typed in the session: `ledger`, `intercept fs.read
 * refuse`, `fs.read README.md`. A probe it runs is recorded as from `from`.
 */
export type LabCommandInput = { text: string; from?: LabRunSource }

/**
 * `$.lab`, for other plugins: the explorer bridge asks the lab to run probes
 * and commands through it, so each happens inside the lab's own hooks.
 */
export type Lab = {
  /** Runs a probe and answers the run as the lab recorded it. */
  run: (input: LabRunInput) => Promise<LabRun>
  /** The probe catalog. */
  probes: () => Promise<readonly LabProbe[]>
  /** Does what `/mod-lab <text>` does, and answers the text the command would show. */
  command: (input: LabCommandInput) => Promise<string>
  /** The op events the lab can intercept. */
  interceptable: () => Promise<readonly string[]>
  /** The lab's folder, as its own `$.plugin.root`: where the engine lays its declarations when it loads the lab from a folder. */
  root: () => Promise<string>
}

declare module 'claude-code' {
  interface EngineInterface {
    lab: Lab
  }

  interface PluginState {
    'mod-lab': {
      runs: LabRun[]
      traces: LabTraceRow[]
      probe: string
      drafts: { [probe: string]: LabArgText }
      view: LabView
      help: LabHelpView
      isTracing: boolean
      counter: number
      intercepts: LabIntercept[]
      interceptDraft: LabInterceptDraft
      taps: LabTap[]
      ledger: LabLedger
      spend: LabSpend
      agents: LabAgents
      rows: LabRows
      compactor: LabCompactor
      keys: LabKeys
      config: LabConfigRow[]
    }
  }
}
