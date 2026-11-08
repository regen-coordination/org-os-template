// Security headers when hosted (L9 spec §5.10). HSTS belongs to the proxy (§5.3); the portal's headers are the proxy's.
import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

/** `sha256-<base64>` of each inline `<script>` in the built `index.html` (a script with `src` has none): the prepaint
 *  script that picks the skin before the stylesheet is used. Computed at start. */
export function prepaintHashes(indexHtml: string): string[] {
  const out: string[] = []
  for (const m of indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1]!)) continue
    out.push(`sha256-${createHash('sha256').update(m[2]!, 'utf8').digest('base64')}`)
  }
  return out
}

/** The Content-Security-Policy of §5.10 for `host`, allowing the inline scripts whose hashes are given. */
export function contentSecurityPolicy(host: string, hashes: readonly string[]): string {
  const scripts = ["'self'", ...hashes.map(h => `'${h}'`)].join(' ')
  return [
    "default-src 'self'", `script-src ${scripts}`, "style-src 'self'", "style-src-attr 'unsafe-inline'", "img-src 'self' data:",
    `connect-src 'self' wss://${host}`, "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ].join('; ')
}

/** On every answer when hosted (refusals included): the CSP, nosniff, Referrer-Policy and Permissions-Policy; and
 *  `Cache-Control: no-store` on `/api/*`. Set after the route has answered, over anything it set. */
export function securityHeaders(o: { host: string; prepaintHashes: string[] }): MiddlewareHandler {
  const csp = contentSecurityPolicy(o.host, o.prepaintHashes)
  return async (c, next) => {
    await next()
    const h = c.res.headers
    h.set('Content-Security-Policy', csp)
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('Referrer-Policy', 'same-origin')
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store')
  }
}
