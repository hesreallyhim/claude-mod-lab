/** Time spent in tool calls this session, by tool name: how many calls, and their milliseconds summed. */
export type StopwatchTotals = { [tool: string]: { calls: number; ms: number } }

/** The latest tool call: the tool, its command, path or pattern, how long it took, and whether the model got an error back. */
export type StopwatchCall = { tool: string; detail: string; ms: number; failed: boolean }

declare module 'claude-code' {
  interface PluginState {
    /** `slowCalls`: the calls this session that took longer than the `slowAfter` option. */
    stopwatch: { totals: StopwatchTotals; latest: StopwatchCall | null; slowCalls: number }
  }
}
