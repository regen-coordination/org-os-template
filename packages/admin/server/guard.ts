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
 *
 * Hosted (L9 spec §5.2), the machine is a server behind a TLS proxy and the same three questions are asked of the one
 * configured address: the Host must be the members' host, an Origin must be the configured `https:` origin exactly,
 * and writes are JSON. Nothing the proxy forwards (`X-Forwarded-*`) is read. The one exception is `GET /api/health`
 * addressed to the loopback, the container's own health check.
 */
export interface Caller {
  method: string
  host: string | undefined        // the Host header
  origin: string | undefined      // the Origin header
  contentType: string | undefined
  /** The request's path; read only when hosted, for the loopback health check. */
  path?: string
}

export interface Refusal { status: 403 | 415; error: string }

/** Where the guard stands: on this machine (L5 and before), or hosted at one configured host and origin (L9 §5.2). */
export type GuardScope = { kind: 'local' } | { kind: 'hosted'; host: string; origin: string }

const LOCAL_SCOPE: GuardScope = { kind: 'local' }
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
/** The container's own health check (§5.11, §6), the one request a hosted Hub answers on the loopback. */
const HEALTH = '/api/health'

function parseHost(host: string | undefined): URL | null {
  if (!host) return null
  try { return new URL(`http://${host}`) } catch { return null }
}

/** Why this caller is refused, or null. With no scope, the local one: as before L9. */
export function refusal(caller: Caller, scope: GuardScope = LOCAL_SCOPE): Refusal | null {
  return scope.kind === 'hosted' ? hostedRefusal(caller, scope) : localRefusal(caller)
}

function hostedRefusal(caller: Caller, scope: Extract<GuardScope, { kind: 'hosted' }>): Refusal | null {
  if (caller.method.toUpperCase() === 'GET' && caller.path === HEALTH && LOCAL.has(parseHost(caller.host)?.hostname ?? '')) return null
  if (caller.host !== scope.host) {
    return { status: 403, error: `Refused: this Hub answers at ${scope.origin}, and the request was addressed to "${caller.host ?? ''}".` }
  }
  if (caller.origin !== undefined && caller.origin !== scope.origin) {
    return { status: 403, error: `Refused: the request came from a page at ${caller.origin}. Only the Hub's own pages (${scope.origin}) may call it.` }
  }
  return notJson(caller)
}

function localRefusal(caller: Caller): Refusal | null {
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
  return notJson(caller)
}

/** A write that carries a body (POST, PUT, PATCH) and is not JSON. */
function notJson(caller: Caller): Refusal | null {
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
