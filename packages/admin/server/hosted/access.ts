// The access log when hosted (L9 spec §7.4, Q-L9-7): one JSON line per request, { t, method, route, status, ms }. The
// route is the path the answering route was registered with (`/api/proposals/:id`, ruling P2a's lookup), `-` when no
// route answered; never the request's own path, its query, a cookie, an address or an actor.
import type { MiddlewareHandler } from 'hono'
import { answeringRoute } from './writes.ts'

export function accessLog(write: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    try {
      await next()
    } finally {
      const line = { t: new Date().toISOString(), method: c.req.method, route: answeringRoute(c) ?? '-', status: c.res.status, ms: Math.round(performance.now() - started) }
      try { write(JSON.stringify(line)) } catch { /* a log that fails is not the request's failure */ }
    }
  }
}
