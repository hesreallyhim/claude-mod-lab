// Shared by the fence checks; not a check itself. The checks' own hooks sit
// beneath every plugin and stand for the engine: here, for the file system
// and the tools.

import type { CommandRunInput, On } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'

/** `/<name> <args>` as typed at the prompt. */
export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** Answers a session's start and each command registration, recording the names registered. */
export function answerStart(on: On): string[] {
  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  return registered
}

/**
 * Another plugin, loaded beside the fence. Its /read command reads a file
 * through $.fs.read, as any plugin can, and answers the text, or why the
 * read was refused.
 */
export const reader: Plugin = {
  name: 'reader',
  register(on) {
    on('command.run', { command: 'read' }, async ($, e) => {
      try {
        return { text: await $.fs.read(e.args) }
      } catch (error) {
        return { text: `refused: ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  },
}

/** What the reader plugin got when it read `path`. */
export async function readAsPlugin($: Engine, path: string): Promise<string> {
  return (await $.command.run(slash('read', path))).text ?? ''
}

/**
 * Stands for the file system: `fs.read` answers from `files`, and `fs.stat`
 * answers each path's real path, which is the path itself unless `links`
 * leads it elsewhere. Answers the list of paths whose reads reached it.
 */
export function disk(on: On, files: { [path: string]: string }, links: { [path: string]: string } = {}): string[] {
  const reached: string[] = []
  on('fs.read', ($, e) => {
    reached.push(e.path)
    const text = files[links[e.path] ?? e.path]
    return text === undefined ? { deny: `ENOENT: no such file, ${e.path}` } : { value: text }
  })
  on('fs.stat', ($, e) => ({
    value: { kind: 'file', size: 0, mtimeMs: 0, isLink: e.path in links, realPath: links[e.path] ?? e.path },
  }))
  return reached
}

/** Stands for every tool, recording the file paths of the calls that reached it. */
export function runTools(on: On): string[] {
  const reached: string[] = []
  on('tool.call', ($, e) => {
    reached.push('file_path' in e ? String(e.file_path) : e.tool)
    return { result: `${e.tool} ran` }
  })
  return reached
}
