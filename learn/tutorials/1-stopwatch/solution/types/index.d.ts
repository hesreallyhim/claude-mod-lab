/** Time spent in tool calls this session, by tool name: how many calls, and their milliseconds summed. */
export type StopwatchTotals = { [tool: string]: { calls: number; ms: number } }

declare module 'claude-code' {
  interface PluginState {
    stopwatch: { totals: StopwatchTotals }
  }
}
