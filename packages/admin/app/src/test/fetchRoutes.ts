import { vi } from 'vitest'

type Answer = unknown | Response | ((init: RequestInit | undefined, url: URL) => unknown | Response)

/** A `fetch` stub that answers by "METHOD /path?query" (or "METHOD /path" for any query).
 *  Keys use the encoded path the client sends, e.g. "GET /api/resources/module%3Aa". */
export function fetchRoutes(routes: Record<string, Answer>) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const key = [`${method} ${url.pathname}${url.search}`, `${method} ${url.pathname}`].find(k => k in routes)
    if (!key) return new Response(JSON.stringify({ error: `no stub for ${method} ${url.pathname}${url.search}` }), { status: 404 })
    const answer = routes[key]
    const value = await (typeof answer === 'function' ? (answer as (i: RequestInit | undefined, u: URL) => unknown)(init, url) : answer)
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
