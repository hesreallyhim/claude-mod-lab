/**
 * @typedef {object} PageChecks
 * @property {import('playwright-core').Page} page
 * @property {Awaited<ReturnType<typeof import('./server.mjs').startServer>>} server
 * @property {(condition: boolean, message: string) => void} expect
 * @property {string} workspace
 * @property {string} REPO
 */

/** Name the failing section without hiding the original Playwright callsite. */
export async function stage(name, run) {
  console.log(`\n== ${name}`)
  try {
    await run()
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error })
  }
}
