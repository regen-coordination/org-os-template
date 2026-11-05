/**
 * Who may call this server.
 *
 * There is no sign-in in v1: "the surface is the machine". That holds only if
 * a request really comes from this machine's own tools or from the app's own
 * page. A browser will send other pages' requests here too, so three things
 * are checked before any route runs:
 *
 * - Host: the request must be addressed to localhost. A DNS-rebinding page (a
 *   site that re-points its own name at 127.0.0.1) arrives with its own name.
 * - Origin: a browser states the page a request came from. When that header is
 *   present it must be the address the request was sent to, which is only true
 *   of the app's own page. Callers that are not browsers (curl, scripts,
 *   agents) send no Origin and are not affected.
 * - Content type: a write that carries a body (POST, PUT, PATCH) must be JSON.
 *   A cross-site form or `text/plain` POST is the one write a browser sends
 *   without asking the server first. A DELETE carries no body and is not asked.
 */
export interface Caller {
  method: string
  host: string | undefined        // the Host header
  origin: string | undefined      // the Origin header
  contentType: string | undefined
}

export interface Refusal { status: 403 | 415; error: string }

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseHost(host: string | undefined): URL | null {
  if (!host) return null
  try { return new URL(`http://${host}`) } catch { return null }
}

export function refusal(caller: Caller): Refusal | null {
  const host = parseHost(caller.host)
  if (!host || !LOCAL.has(host.hostname)) {
    return { status: 403, error:
      `Refused: this server answers only on this machine, and the request was addressed to "${caller.host ?? ''}". ` +
      `Use the server's own address instead: http://localhost:${host?.port || '<its port>'}.` }
  }
  if (caller.origin !== undefined) {
    let origin: URL | null = null
    try { origin = new URL(caller.origin) } catch { /* "null", or not a URL */ }
    if (!origin || origin.protocol !== 'http:' || origin.host !== host.host) {
      return { status: 403, error:
        `Refused: the request came from a page at ${caller.origin}. ` +
        `Only the admin app's own page (http://${host.host}) may call this API from a browser.` }
    }
  }
  if (['POST', 'PUT', 'PATCH'].includes(caller.method.toUpperCase())) {
    const type = (caller.contentType ?? '').split(';')[0]!.trim().toLowerCase()
    if (type !== 'application/json') {
      return { status: 415, error:
        `Refused: a write must be sent as JSON. Set the header "content-type: application/json" ` +
        `(the request had ${caller.contentType ? `"${caller.contentType}"` : 'no content type'}).` }
    }
  }
  return null
}
