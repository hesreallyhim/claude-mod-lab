// The transcript file of the connected session, read for one record at a
// time: where the file is, from the session's folder and id, and the record
// a row's uuid names, with its line in the file. The X-ray asks for a row's
// record when the person opens it; nothing reads the file otherwise.

import { createReadStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `value` is a row id as the engine writes them, which is all the file is asked for. */
export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * Where Claude Code writes the session's transcript: under its config folder,
 * in a folder named for the session's directory with every character that is
 * not a letter, digit or hyphen turned into a hyphen.
 *
 * @param {{ cwd: string, sessionId: string, configDir?: string }} session
 */
export function transcriptPath({
  cwd,
  sessionId,
  configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
}) {
  return join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9-]/g, '-'), `${sessionId}.jsonl`)
}

/**
 * The record whose `uuid` is `uuid`, and its line in the file (the first line
 * is 1); null when the file has none. The file is read line by line and left
 * as soon as the record is found; a line that is not JSON is passed over.
 *
 * @param {string} path
 * @param {string} uuid
 * @returns {Promise<{ record: object, line: number } | null>}
 */
export async function findRecord(path, uuid) {
  if (!existsSync(path)) return null
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let line = 0
  try {
    for await (const text of lines) {
      line += 1
      // The id is quoted in the line before the line is parsed, so most lines are not parsed at all.
      if (!text.includes(uuid)) continue
      let record
      try {
        record = JSON.parse(text)
      } catch {
        continue
      }
      if (record?.uuid === uuid) return { record, line }
    }
    return null
  } finally {
    lines.close()
    stream.destroy()
  }
}
