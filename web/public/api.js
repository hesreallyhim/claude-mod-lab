// Requests to the explorer server, carrying the token the page was served with.

let token = null

/** The page's token, read from its meta tag when first asked, so this module imports outside a page. */
export function pageToken() {
  token ??= document.querySelector('meta[name="lab-token"]')?.getAttribute('content') ?? ''
  return token
}

export async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { 'x-lab-token': pageToken(), 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(body?.error ?? `the server answered ${response.status}`)
  return body
}
