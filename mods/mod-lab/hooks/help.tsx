// What /mod-lab help shows: each subcommand, what it is for, and its other
// forms. The command answers with the list as text, which the model reads; the
// person sees the start box drawn in its place (drawHelpBox), and every
// command in the pane's Help tab.

import type { Elements, RenderElement } from 'claude-code'

import { MAX_SERVE_SECONDS } from './explorer'

/** What a subcommand is for, as /mod-lab help groups them, in the order it lists them. */
export const KINDS = {
  start: 'Start here',
  calls: 'Watch and change calls',
  model: 'What the model reads',
  session: 'The session',
  checks: 'Checks',
} as const

export type Subcommand = {
  /** The word after /mod-lab: '' for /mod-lab alone, `<probe>` for a probe's id. */
  name: string
  /** What may follow the word, in its simplest form; the details give the rest. */
  args: string
  kind: keyof typeof KINDS
  /** What it does, in a line. */
  does: string
  /** What /mod-lab help <name> adds: the other forms and an example. */
  details?: readonly string[]
  /** For the start box that /mod-lab help draws: how it is typed there, and a few words on it. */
  box?: { typed: string; says: string }
}

/** Each subcommand, as /mod-lab help and the argument hint list it. dispatch has a case for each name, which the type-check holds it to. */
export const SUBCOMMANDS = [
  {
    name: '',
    args: '',
    kind: 'start',
    does: "open the lab's pane beside the conversation",
    box: { typed: '/mod-lab', says: "the lab's pane" },
  },
  {
    name: 'explorer',
    args: '',
    kind: 'start',
    does: "the explorer's address, for the API reference, live views of this session and the lessons",
    box: { typed: '/mod-lab explorer', says: 'the explorer (the reference, this session, the lessons)' },
    details: [
      `/mod-lab explorer serve <seconds> keeps a session started with -p open for the explorer, up to ${MAX_SERVE_SECONDS} s.`,
    ],
  },
  {
    name: 'add',
    args: '<example> [--local]',
    kind: 'start',
    does: 'copy a runnable example to your shared lab, or this project with --local',
    details: [
      '/mod-lab add gallery adds the complete gallery mod; then /mod-gallery opens it.',
      'Other examples use their full name, such as /mod-lab add raster-mod.',
      'Shared copies go to ~/.claude-mod-lab/examples/; --local copies to .claude/mod-lab/ in this project. Existing copies are preserved.',
      'A session watching the destination loads the plugin automatically. Otherwise restart with npx claude-mod-lab run (or run --local for a project copy).',
    ],
  },
  {
    name: 'list',
    args: '',
    kind: 'start',
    does: 'the probes, short calls on $ that you can run',
    box: { typed: '/mod-lab list', says: 'the probes you can run' },
  },
  {
    name: 'init-lessons',
    args: '',
    kind: 'start',
    does: 'enable lessons in the current project without leaving the session',
    box: { typed: '/init-lessons', says: 'start learning in this project' },
    details: ['Also available as /init-lessons. Existing project files are preserved. Requires a session started with the lab launcher.'],
  },
  {
    name: '<probe>',
    args: '[value]',
    kind: 'start',
    does: 'run a probe and see what it returned and every event it raised, as in /mod-lab fs.read README.md',
    box: { typed: '/mod-lab fs.read README.md', says: 'run one, and see what it did' },
    details: [
      'A value fills the probe\'s first parameter; JSON names them all, as in /mod-lab fs.read {"path": "README.md"}.',
      '/mod-lab list shows the probes.',
    ],
  },
  { name: 'help', args: '[command]', kind: 'start', does: "every command, or one command's details" },
  {
    name: 'trace',
    args: 'on|off',
    kind: 'calls',
    does: 'record what the session does (prompts, turns, tool calls) for the pane and the explorer; on by default',
  },
  {
    name: 'intercept',
    args: '',
    kind: 'calls',
    does: "put the lab's own hook on a call, to watch it or change its result",
    details: [
      'With nothing after it, the intercepts in force and the calls they caught.',
      '/mod-lab intercept <event> <behavior> [whose calls] [value]',
      '  behavior: watch, refuse, answer <json>, rewrite <json fields>, or delay <ms>',
      "  whose calls: lab (the lab's own probes), others (other plugins'), or all. Left out, watch covers all, and the others the lab's own.",
      "  An intercept on other plugins' calls ends after a minute, unless it only watches.",
      '  For example: /mod-lab intercept fs.read refuse',
      '/mod-lab intercept events — the calls that can be intercepted',
      '/mod-lab intercept census [event] — totals of the calls caught (who made them, what answered, how long they took)',
      '/mod-lab intercept clear [event] — remove one intercept, or all',
    ],
  },
  {
    name: 'ledger',
    args: '',
    kind: 'model',
    does: 'everything the model reads in this session, and which plugin or source added each part',
  },
  {
    name: 'rows',
    args: '',
    kind: 'model',
    does: "the conversation's rows, how each came in, and who reads it (you, the model, or both)",
  },
  {
    name: 'note',
    args: '<text>',
    kind: 'model',
    does: 'add model context, hidden from chat; saved in JSONL if persistence is enabled; starts no turn',
  },
  { name: 'notice', args: '<text>', kind: 'model', does: 'add a chat notice, saved in JSONL if persistence is enabled; its row is excluded from model input' },
  {
    name: 'compactor',
    args: '',
    kind: 'model',
    does: "the session's compactions, and what produced each",
    details: [
      '/mod-lab compactor keep <n> has the lab do the compactions itself, keeping the first message, a summary it writes, and the last n messages.',
      '/mod-lab compactor off leaves them to Claude Code again.',
    ],
  },
  {
    name: 'compact',
    args: '[instructions]',
    kind: 'model',
    does: "compact the conversation now, which can't be undone (in the session, /compact does the same)",
  },
  {
    name: 'agent',
    args: '',
    kind: 'session',
    does: "the session's agents and their answers, and starting new ones",
    details: [
      '/mod-lab agent register {json} — register an agent type with name, description and prompt, and optionally model, tools and maxTurns',
      '/mod-lab agent spawn <type> <prompt> — start one in the background; its answer comes when it finishes',
      '/mod-lab agent hide <type>, show <type> — keep a type from the model, or offer it again; plugins can still spawn it',
      '/mod-lab agent route <model>, route off — send every new spawn to one model, or stop',
      "/mod-lab agent transcript <agentId> — an agent's own conversation",
    ],
  },
  {
    name: 'spend',
    args: '',
    kind: 'session',
    does: "the model calls the session's plugins made, with their tokens, and whether each was sent",
  },
  {
    name: 'free',
    args: 'on|off',
    kind: 'session',
    does: "answer the lab's own model calls itself, so its model probes send nothing and cost nothing",
  },
  {
    name: 'keys',
    args: '',
    kind: 'session',
    does: 'recent changes to the prompt box (keys pressed, text added or removed, decorations)',
  },
  {
    name: 'config',
    args: '[filter]',
    kind: 'session',
    does: 'the /config settings, by the plugin that owns each',
    details: [
      "/mod-lab config set <key> <value> changes one as /config does, so every plugin's config.set hook sees it.",
    ],
  },
  { name: 'verify', args: '', kind: 'checks', does: 'check that Claude Code behaves as the lab expects' },
  {
    name: 'eject',
    args: '[run]',
    kind: 'checks',
    does: "turn a run's calls into hooks for a test, with this session's answers in them, and copy them",
    details: ['Without a run number, the newest run.'],
  },
] as const satisfies readonly Subcommand[]

/** What the prompt box shows after `/mod-lab `: the commands to start with, on one line; /mod-lab help has the rest. */
export const ARGUMENT_HINT = `[${SUBCOMMANDS.flatMap(one => (one.kind === 'start' && one.name !== '' ? [one.name] : [])).join(' | ')}]`

export function usage(one: Subcommand): string {
  return ['/mod-lab', one.name, one.args].filter(part => part !== '').join(' ')
}

/** The full list's first words, which only that answer has: its transcript row is drawn as the box by them. */
export const HELP_INTRO = 'mod-lab runs calls on $, the API every mod uses, and shows what each one did.'

/**
 * /mod-lab help: each subcommand in a line, by what it is for; with a
 * command's name, its other forms. Unpadded, as the desktop app draws the
 * transcript in a proportional face.
 */
export function helpText(asked: string): string {
  const name = asked.trim()
  if (name !== '') {
    const one: Subcommand | undefined = SUBCOMMANDS.find(sub => sub.name === name)
    if (one === undefined) return `No /mod-lab ${name}. /mod-lab help lists the commands, and /mod-lab list the probes.`
    return [`${usage(one)} — ${one.does}`, ...(one.details ?? [])].join('\n')
  }
  const groups = Object.entries(KINDS).map(([kind, title]) =>
    [title, ...SUBCOMMANDS.filter(one => one.kind === kind).map(one => `  ${usage(one)} — ${one.does}`)].join('\n'),
  )
  return [`${HELP_INTRO} /mod-lab help <command> gives a command's other forms.`, ...groups].join('\n\n')
}

type Ui = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

/**
 * The box /mod-lab help draws in the transcript in place of its text: the lab
 * in a line, the commands to start with and what each does, then every other
 * group's commands by name, and where their details are. `page` is the
 * explorer's address while it serves, shown in its row.
 */
export function drawHelpBox(ui: Ui, page: string | null): RenderElement {
  const { Box, Text } = ui
  const start = SUBCOMMANDS.flatMap(one => ('box' in one ? [one.box] : []))
  const groups = Object.entries(KINDS).flatMap(([kind, title]) =>
    kind === 'start' ? [] : [{ kind, title, names: SUBCOMMANDS.filter(one => one.kind === kind).map(one => one.name) }],
  )
  const width = Math.max(...start.map(entry => entry.typed.length), ...groups.map(group => group.title.length)) + 3
  const row = (key: string, left: RenderElement, right: RenderElement) => (
    <Box key={key} flexDirection="row">
      <Box width={width} flexShrink={0}>
        {left}
      </Box>
      {right}
    </Box>
  )
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      <Text>
        <Text bold color="claude">
          mod-lab
        </Text>{' '}
        runs calls on $, the API every mod uses, and shows what each one did.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{KINDS.start}</Text>
        {start.map(entry =>
          row(
            `start:${entry.typed}`,
            <Text color="suggestion">{entry.typed}</Text>,
            <Text>
              {entry.typed === '/mod-lab explorer' && page !== null ? `the explorer, at ${page}` : entry.says}
            </Text>,
          ),
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {groups.map(group =>
          row(
            `group:${group.kind}`,
            <Text bold>{group.title}</Text>,
            <Text color="suggestion">{group.names.join(' · ')}</Text>,
          ),
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          /mod-lab help &lt;command&gt; for one command's details; the Help tab in the lab's pane has them all.
        </Text>
      </Box>
    </Box>
  )
}
