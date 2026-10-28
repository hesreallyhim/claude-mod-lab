// Runtime version reporting and the lesson catalog's declared minimum versions.

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

/** Whether a lesson needs a newer version than the session runs; false without a minimum, or with no session to compare. */
export function needsNewer(since, version) {
  return typeof since === 'string' && version !== null && compareVersions(version, since) < 0
}
