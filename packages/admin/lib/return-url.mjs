// packages/admin/lib/return-url.mjs
//
// The I6 return rule: where the Hub may send a person after they sign in. Only to one of its own paths, or over https
// to the org's domain or a host inside it; anything else goes to the Hub's root, so the sign-in is never an open
// redirect (Review Focus 4). Plain ESM with no node: import, so the client can judge a return the same way.

/** Characters no return may hold: whitespace and controls (a URL parser drops some of them silently), a backslash (a
 *  browser reads `/\` as `//`), and an address (`@`, or `%40`): nothing the Hub keeps for a sign-in holds one. */
const UNSAFE = /[\u0000- \u007f\\@]|%40/i

/** I6: an absolute https URL whose host is `domain` or ends in `.${domain}`, with no credentials and no explicit port,
 *  kept whole (in its normal form); or a same-hub path starting with one '/', kept as written. Anything else, and a
 *  missing domain with any absolute URL, answers `${hub}/`.
 *  @param {string | null | undefined} raw @param {string} hub @param {string | null} domain @returns {string} */
export function safeReturn(raw, hub, domain) {
  const base = String(hub).replace(/\/+$/, '')
  const root = `${base}/`
  if (typeof raw !== 'string' || raw === '' || UNSAFE.test(raw)) return root

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) return root
    let u
    try { u = new URL(raw, root) } catch { return root }
    return u.origin === new URL(root).origin ? raw : root
  }

  if (domain === null || domain === undefined || domain === '') return root
  let u
  try { u = new URL(raw) } catch { return root }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return root
  const d = domain.replace(/^\./, '').toLowerCase()
  const host = u.hostname
  if (host !== d && !host.endsWith(`.${d}`)) return root
  return u.href
}
