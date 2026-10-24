/* global document, getComputedStyle */

/** @param {import('playwright-core').Page} page */
export async function checkContentSecurityPolicy(page, expect) {
  let offOriginRequests = 0
  const blockedUrl = 'https://csp-check.invalid/probe'
  await page.route(blockedUrl, route => {
    offOriginRequests += 1
    return route.abort()
  })
  try {
    const result = await page.evaluate(async url => {
      const script = document.createElement('script')
      const styled = document.createElement('div')
      const violations = new Set()
      let listener
      let timeout
      const blocked = new Promise((resolve, reject) => {
        listener = event => {
          violations.add(event.effectiveDirective)
          if (violations.has('script-src-elem') && violations.has('connect-src')) resolve(true)
        }
        document.addEventListener('securitypolicyviolation', listener)
        timeout = setTimeout(() => reject(new Error('CSP did not block the injected script and connection')), 3000)
      })
      try {
        delete document.documentElement.dataset.cspInlineRan
        script.textContent = "document.documentElement.dataset.cspInlineRan = 'yes'"
        document.body.append(script)
        const connectionRejected = await fetch(url).then(
          () => false,
          () => true,
        )
        await blocked
        styled.setAttribute('style', 'width: 37px')
        document.body.append(styled)
        return {
          inlineScriptRan: document.documentElement.dataset.cspInlineRan === 'yes',
          connectionRejected,
          inlineStyleApplied: getComputedStyle(styled).width === '37px',
        }
      } finally {
        clearTimeout(timeout)
        document.removeEventListener('securitypolicyviolation', listener)
        script.remove()
        styled.remove()
        delete document.documentElement.dataset.cspInlineRan
      }
    }, blockedUrl)
    expect(!result.inlineScriptRan, 'CSP blocks injected inline scripts')
    expect(
      result.connectionRejected && offOriginRequests === 0,
      'CSP blocks off-origin connections before a request is sent',
    )
    expect(result.inlineStyleApplied, 'CSP permits the style attributes used by charts')
  } finally {
    await page.unroute(blockedUrl)
  }
}
