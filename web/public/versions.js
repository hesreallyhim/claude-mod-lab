// Claude Code versions on the page: the version line beside the pill, the
// one notice (update, below compat.json's floor), and whether a template or a
// lesson needs a newer version than the session runs, which the page hides
// rather than explains. No DOM here; web/test/versions.test.mjs checks it.

const NEEDS_NEWER = 'needs a newer version of Claude Code'

/** Negative, zero or positive as `a` is older than, the same release as, or newer than `b`; a build's suffix (`-dev...`) is left out. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map(version => String(version).split('-')[0].split('.').map(Number))
  for (let index = 0; index < Math.max(x.length, y.length); index += 1) {
    const step = (x[index] ?? 0) - (y[index] ?? 0)
    if (step !== 0) return step
  }
  return 0
}

/** The build the session runs: the hello's engine, or the session facts' version from a bridge that sends no engine; null when neither says. */
export function sessionVersion(session) {
  const version = session?.engine?.version ?? session?.facts?.version
  return typeof version === 'string' ? version : null
}

/** The session's build: "Claude Code 2.1.303"; null when the session did not say. */
export function engineText(session) {
  const version = sessionVersion(session)
  return version === null ? null : `Claude Code ${version}`
}

/** The notice beside the version line: below compat.json's floor, to update; null at or above it. Past the version tested through says nothing. */
export function updateText(version, compat) {
  return compareVersions(version, compat.floor) < 0 ? 'Update Claude Code to use mod-lab.' : null
}

/** Whether a template or a lesson needs a newer version than the session runs; false without a minimum, or with no session to compare. */
export function needsNewer(since, version) {
  return typeof since === 'string' && version !== null && compareVersions(version, since) < 0
}

/** A run the lab's capability table kept from running: it was not run, rather than failed. */
export function isNotRun(run) {
  return run.ok === false && typeof run.error === 'string' && run.error.startsWith(NEEDS_NEWER)
}
