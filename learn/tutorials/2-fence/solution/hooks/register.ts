// fence: keeps .env files from the reads plugins make through $ and from the
// model's Read tool, and redacts secret-looking lines from what plugins read.
// The finished mod of the second tutorial, learn/tutorials/2-fence/README.md.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const reads: { [plugin: string]: number } = {}

function describe(): string {
  const rows = Object.entries(reads).sort(([, a], [, b]) => b - a)
  if (rows.length === 0) return 'No plugin has read a file through $ yet.'
  return `Reads through $ by plugin: ${rows.map(([plugin, n]) => `${plugin} ${n}`).join(', ')}`
}

/** Whether a file's name marks it as secret: .env, .env.local, prod.env. */
function isSecret(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env')
}

/** Whether the path, or the file its links lead to, is fenced. A path that resolves nowhere is. */
async function isFenced($: Dollar, path: string): Promise<boolean> {
  if (isSecret(path)) return true
  const { realPath } = await $.fs.stat(path, { resolve: true })
  return realPath === undefined || isSecret(realPath)
}

const SECRET_LINE = /^(\s*[\w.-]*(?:key|token|secret|password)[\w.-]*\s*[:=]\s*)\S.*$/gim

function redact(text: string): string {
  return text.replace(SECRET_LINE, '$1[redacted by fence]')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fence', description: 'Which plugins read files through $' })
    return next(e)
  })

  on('command.run', { command: 'fence' }, async () => ({ text: describe() }))

  on('fs.read', async ($, e, next) => {
    const who = next.origin.plugin
    reads[who] = (reads[who] ?? 0) + 1
    if (await isFenced($, e.path)) return { deny: `fence: ${who} may not read ${e.path}` }
    const result = await next(e)
    return 'value' in result && typeof result.value === 'string' ? { value: redact(result.value) } : result
  }).catch(($, e) => ({ deny: `fence: could not check ${e.path}, so it stays closed` }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) =>
    (await isFenced($, e.file_path)) ? { deny: `fence: ${e.file_path} is fenced; ask the person for what you need from it` } : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: `fence: could not check ${e.file_path}, so it stays closed` }))
}
