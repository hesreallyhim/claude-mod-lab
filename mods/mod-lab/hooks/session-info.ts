import type { EngineInterface } from 'claude-code'

type Dollar = EngineInterface

const SURFACE_NAMES: Readonly<Record<string, string>> = { terminal: 'the terminal', desktop: 'the desktop app', vscode: 'VS Code', mobile: 'the mobile app' }

/** The surfaces in words: "in the terminal and the desktop app", or none attached, as in a -p run. */
export function surfacesText(surfaces: readonly string[]): string {
  if (surfaces.length === 0) return 'with no window attached'
  const names = surfaces.map(surface => SURFACE_NAMES[surface] ?? surface)
  return `in ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}`
}

/** /mod-lab's session surface summary. The version number is shown by /mod-lab verify and the explorer. */
export async function engineLine($: Dollar): Promise<string> {
  let surfaces = ''
  try {
    surfaces = ` ${surfacesText(await $.session.surfaces())}`
  } catch {
    // Surfaces are left out of the line where the session does not answer them.
  }
  return `mod-lab is running${surfaces}.`
}
