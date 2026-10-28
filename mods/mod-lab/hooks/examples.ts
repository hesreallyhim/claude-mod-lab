import type { EngineInterface } from 'claude-code'

const SERVER = 'plugin:mod-lab-bridge:explorer'
const USAGE = 'Use /mod-lab add <example> [--local]. For example: /mod-lab add gallery. Copies go to your shared lab; --local adds to this project.'

type AddedExample = { directory: string; name: string; command: string | null; howToTry: string | null }

function addedExample(text: string): AddedExample {
  const value = JSON.parse(text) as Partial<AddedExample>
  if (typeof value.directory !== 'string' || typeof value.name !== 'string' ||
      (value.command !== null && typeof value.command !== 'string') ||
      (value.howToTry !== null && typeof value.howToTry !== 'string')) {
    throw new Error('The bridge returned no example details.')
  }
  return value as AddedExample
}

/** Copy a complete example; a watched plugin collection discovers its manifest after copying. */
export async function addExampleCommand($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const names = words.filter(word => word !== '--local')
  const requested = names[0]
  if (names.length !== 1 || requested === undefined || requested.startsWith('-') || words.length > 2) return USAGE
  const scope = words.includes('--local') ? 'local' : 'shared'
  const name = requested === 'gallery' ? 'gallery-mod' : requested
  const cwd = await $.session.cwd()
  const result = await $.mcp.call(SERVER, 'add-example', { cwd, name, scope })
  const text = result.content.map(block => block.text ?? '').join('\n').trim()
  if (result.isError) throw new Error(`The example was not added: ${text}`)
  const added = addedExample(text)
  const directories: unknown = JSON.parse((await $.env.get('MOD_LAB_COMPONENT_DIRS')) || '[]')
  const watched = Array.isArray(directories) && directories.includes(added.directory)
  const loading = watched
    ? 'This session watches that folder. The plugin loads when Claude Code detects its manifest; if its command is not available yet, use /reload-plugins.'
    : `This session does not watch that folder. Restart with npx claude-mod-lab run${scope === 'local' ? ' --local' : ''} in this project to load it.`
  return [`Added ${added.name} to ${added.directory}/${added.name}.`, loading, added.howToTry ?? (added.command ? `Run /${added.command} to try it.` : '')].filter(Boolean).join('\n')
}
