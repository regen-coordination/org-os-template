// Rate limits when hosted (L9 spec §5.9, §10 `RATE`). In memory: token buckets per key, at most 10,000 keys, the least
// recently used dropped. The client address is `X-Real-IP` only with ORG_OS_TRUST_PROXY on (the proxy sets it, replacing
// what a client sent), else the socket's peer. Locally there are no limits: nothing here is mounted.
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Context, MiddlewareHandler } from 'hono'
import { sessionToken } from '../session/sessions.ts'
import { answeringRoute } from './writes.ts'

/** §10's sentence, verbatim. */
export const RATE = (n: number): string => `Too many requests from here in a short time. Wait ${n} seconds, then try again.`

/** Open WebSocket connections per client address (§5.9). */
export const WS_PER_ADDRESS = 10

/** Token buckets: each key's bucket holds `burst` tokens and refills at `ratePerMin`; a take spends one. At most
 *  `maxKeys` buckets are kept, the least recently used dropped first (a dropped key starts full again). */
export class Buckets {
  private readonly perMs: number
  private readonly maxKeys: number
  private readonly now: () => number
  private readonly held = new Map<string, { tokens: number; at: number }>()
  constructor(private readonly o: { ratePerMin: number; burst: number; maxKeys?: number; now?: () => number }) {
    this.perMs = o.ratePerMin / 60_000
    this.maxKeys = o.maxKeys ?? 10_000
    this.now = o.now ?? Date.now
  }
  get size(): number { return this.held.size }
  take(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const t = this.now()
    const b = this.held.get(key) ?? { tokens: this.o.burst, at: t }
    this.held.delete(key) // re-inserted last: the Map's order is the use order
    b.tokens = Math.min(this.o.burst, b.tokens + Math.max(0, t - b.at) * this.perMs)
    b.at = t
    this.held.set(key, b)
    while (this.held.size > this.maxKeys) this.held.delete(this.held.keys().next().value!)
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true } }
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - b.tokens) / this.perMs / 1000)) }
  }
}

/** The client's address: `X-Real-IP` when the proxy is trusted and sent one, else the socket's peer. */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const real = c.req.header('x-real-ip')?.trim()
    if (real) return real
  }
  const env = c.env as { incoming?: Pick<IncomingMessage, 'socket'> } | undefined
  return env?.incoming?.socket?.remoteAddress ?? 'unknown'
}

/** The same address for a WebSocket upgrade, which does not pass through the Hono app. */
export function upgradeAddress(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: boolean): string {
  if (trustProxy) {
    const h = req.headers['x-real-ip']
    const real = (Array.isArray(h) ? h[0] : h)?.trim()
    if (real) return real
  }
  return req.socket.remoteAddress ?? 'unknown'
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const hash = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 32)

/** §5.9's table: the nonce and sign-in per address, 10/min (5) each; any other write per session, 60/min (20); any read
 *  per address, 300/min (100). A write with no session cookie is keyed by its address (the request middleware answers it
 *  401 after). The route is the one that answers (ruling P2a's lookup). A refusal is 429 with `Retry-After` and `RATE`. */
export function rateLimits(o: { trustProxy: boolean; now?: () => number }): MiddlewareHandler {
  const clock = o.now ? { now: o.now } : {}
  const nonce = new Buckets({ ratePerMin: 10, burst: 5, ...clock })
  const signIn = new Buckets({ ratePerMin: 10, burst: 5, ...clock })
  const writes = new Buckets({ ratePerMin: 60, burst: 20, ...clock })
  const reads = new Buckets({ ratePerMin: 300, burst: 100, ...clock })
  return async (c, next) => {
    const method = c.req.method
    const route = method === 'POST' ? answeringRoute(c) : null
    const address = () => `a:${clientAddress(c, o.trustProxy)}`
    let taken
    if (route === '/api/session/nonce') taken = nonce.take(address())
    else if (route === '/api/session') taken = signIn.take(address())
    else if (READS.has(method)) taken = reads.take(address())
    else {
      const cookie = c.req.header('cookie')
      const token = sessionToken(cookie, true) || sessionToken(cookie, false)
      taken = writes.take(token ? `s:${hash(token)}` : address())
    }
    if (!taken.ok) {
      c.header('Retry-After', String(taken.retryAfterS))
      return c.json({ error: RATE(taken.retryAfterS), code: 'RATE' }, 429)
    }
    await next()
  }
}
