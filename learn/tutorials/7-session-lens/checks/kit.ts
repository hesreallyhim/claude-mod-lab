// The kit supplies message projections explicitly. It does not pretend to save
// JSONL or resume a process: the lesson's final step checks those in a session.
import type { ApiMessage, On, RenderPropsOf, SessionMessage } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export const NOTE = 'SESSION-LENS NOTE: the museum locker is cobalt.'
export const NOTICE = 'SESSION-LENS NOTICE: the desk lamp is amber.'
const PROPS: RenderPropsOf['Pane'] = {
  title: 'Session lens', isFocused: true, bodyColumns: 90, placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}

type Fixtures = { plain?: SessionMessage[]; api?: ApiMessage[]; denyAppend?: string; dropPrompt?: string }
export async function desk($: Engine, on: On, fixtures: Fixtures = {}) {
  const session = fixtures.denyAppend ? { appended: () => [] } : mock.session(on)
  const prompts: string[] = []
  const reads: Array<string | undefined> = []
  on('session.id', () => ({ value: 'session-lens-test-id' }))
  on('session.cwd', () => ({ value: '/lesson-workspace' }))
  on('session.version', () => ({ value: { version: '2.1.310' } }))
  on('session.messages', ($, e) => {
    reads.push(e.as)
    return { value: e.as === 'api' ? fixtures.api ?? [] : fixtures.plain ?? [] }
  })
  if (fixtures.denyAppend) on('session.append', () => ({ deny: fixtures.denyAppend! }))
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return fixtures.dropPrompt ? { drop: fixtures.dropPrompt } : { text: e.text }
  })
  const ui = await $.ui.mount({
    plugin: 'session-lens', surface: 'terminal', component: 'Pane', requestId: 'session-lens',
    props: PROPS, viewport: { columns: 100, rows: 50 },
  })
  const text = async () => (await ui.findAll({ type: 'Text' })).map(node => node.text ?? '').join('\n')
  return { ui, text, session, prompts, reads }
}

export const message = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
export const apiMessage = (text: string): ApiMessage => ({ role: 'user', content: [{ type: 'text', text }] })
