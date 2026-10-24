// Shared by the receipt checks; not a check itself.

import type { On, ToolSpec } from 'claude-code'

/** Answers the session's start and each tool registration, as the engine would, recording the specs. */
export function answerStart(on: On): ToolSpec[] {
  const registered: ToolSpec[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => {
    registered.push(e)
    return { value: { tool: `mcp__receipt__${e.name}` } }
  })
  return registered
}

/** The name the model calls the tool by: mcp__<plugin>__<name>. */
export const TOOL = 'mcp__receipt__total'
