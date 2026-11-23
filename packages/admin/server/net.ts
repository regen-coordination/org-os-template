import { lookup as dnsLookup } from 'node:dns'
import { lookup as dnsLookupPromise, resolveTxt as dnsResolveTxt } from 'node:dns/promises'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { FetchLike } from './systems/driver.ts'

/** Whether an IP address (v4 or v6) is one a stranger could reach: not loopback, private, link-local, CGNAT, unique-local, multicast or unspecified. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b, c] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // 192.0.0.0/24 IETF protocol assignments, 192.0.2.0/24 TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false
    return true
  }
  if (kind === 6) {
    const groups = expandV6(address)
    if (groups === null) return false
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    // v4-mapped (::ffff:a.b.c.d) and v4-compatible: judged as the v4 address inside.
    if (groups.slice(0, 5).every(g => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
      if (groups.slice(0, 6).every(g => g === 0) && groups[6] === 0 && groups[7] <= 1) return false // :: and ::1
      return isPublicAddress(v4(groups[6], groups[7]))
    }
    // NAT64 (64:ff9b::/96 well-known, 64:ff9b:1::/48 local-use, RFC 8215): judged as the v4 address in the last 32 bits.
    if (groups[0] === 0x64 && groups[1] === 0xff9b && (groups[2] === 1 || groups.slice(2, 6).every(g => g === 0))) {
      return isPublicAddress(v4(groups[6], groups[7]))
    }
    // 6to4 (2002::/16): judged as the v4 address in bits 16–47.
    if (groups[0] === 0x2002) return isPublicAddress(v4(groups[1], groups[2]))
    if ((groups[0] & 0xfe00) === 0xfc00) return false // fc00::/7 unique-local
    if ((groups[0] & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
    if ((groups[0] & 0xffc0) === 0xfec0) return false // fec0::/10 site-local
    if ((groups[0] & 0xff00) === 0xff00) return false // multicast
    return true
  }
  return false
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function expandV6(address: string): number[] | null {
  let a = address.split('%')[0].toLowerCase()
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (tail) {
    const p = tail[1].split('.').map(Number)
    if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return null
    a = `${a.slice(0, -tail[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null
  const all = [...head, ...Array(fill).fill('0'), ...rest]
  const out = all.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return out.length === 8 && out.every(n => Number.isFinite(n)) ? out : null
}

/** The most the real fetch takes in from one answer; a caller's own cap is lower and is checked on the text. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

type Resolve = (host: string, options: { all: true; family?: number; hints?: number; verbatim?: boolean }, cb: (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void) => void

/** The sentence for an answer that includes a non-public address, or null when every address is public. */
export function nonPublicAnswer(addresses: { address: string }[]): string | null {
  if (addresses.length === 0) return 'no address'
  const bad = addresses.find(a => !isPublicAddress(a.address))
  return bad ? 'a non-public address' : null
}

/** The `lookup` option of the real connection: the connection is made to an address checked here, at connect time, so
 *  a host that answered public to an earlier check and private to this one (DNS rebinding) is refused. */
export function connectLookup(resolve: Resolve = dnsLookup as unknown as Resolve) {
  return (host: string, options: { all?: boolean; family?: number; hints?: number }, cb: (...args: any[]) => void): void => {
    resolve(host, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err)
      const problem = nonPublicAnswer(addresses)
      if (problem !== null) return cb(Object.assign(new Error(`${host} resolves to ${problem}`), { code: 'ENONPUBLIC' }))
      if (options.all) return cb(null, addresses)
      cb(null, addresses[0].address, addresses[0].family)
    })
  }
}

/** A fetch over `node:https` that connects only to public addresses, never follows a redirect (a 3xx comes back as
 *  it is), honours `signal`, and takes a string or Uint8Array body. https only. */
export function httpsFetch(request: typeof httpsRequest = httpsRequest, lookup = connectLookup()): FetchLike {
  return (url, init) => new Promise((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch { return reject(new TypeError(`${url} is not an address`)) }
    if (u.protocol !== 'https:') return reject(new TypeError('only https is fetched'))
    if (init.signal?.aborted) return reject(new Error('aborted'))
    const payload = (init as { body?: string | Uint8Array }).body
    // What undici added on its own: a User-Agent (api.github.com answers 403 without one) and the body's length.
    const headers: Record<string, string> = { ...init.headers }
    const has = (name: string) => Object.keys(headers).some(k => k.toLowerCase() === name)
    if (!has('user-agent')) headers['user-agent'] = 'org-os-admin'
    if (payload !== undefined && !has('content-length')) headers['content-length'] = String(Buffer.byteLength(payload))
    const options: RequestOptions = { method: init.method, headers, lookup: lookup as RequestOptions['lookup'], signal: init.signal }
    const req = request(u, options, res => {
      const chunks: Buffer[] = []
      let size = 0
      let failed: Error | null = null
      let done: Promise<Buffer> | null = null
      const body = () => (done ??= new Promise<Buffer>((ok, bad) => {
        if (failed) return bad(failed)
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_RESPONSE_BYTES) { failed = new Error('answer too large'); res.destroy(failed); return }
          chunks.push(c)
        })
        res.on('end', () => ok(Buffer.concat(chunks)))
        res.on('error', bad)
        res.on('aborted', () => bad(new Error('aborted')))
        init.signal?.addEventListener('abort', () => { res.destroy(); bad(new Error('aborted')) })
      }))
      const status = res.statusCode ?? 0
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => { const v = res.headers[name.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null } },
        text: async () => (await body()).toString('utf8'),
        json: async () => JSON.parse((await body()).toString('utf8')) as unknown,
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const realFetch = httpsFetch()

/** The one real network call. Under a test run (vitest sets VITEST) it refuses, so a test that
 *  forgot to inject a fake fetch fails loudly instead of reaching out (ruling S13). */
export const networkFetch: FetchLike = async (url, init) => {
  if (process.env.VITEST) throw new Error(`no network in tests: ${url} (inject a fake fetch)`)
  return realFetch(url, init)
}

/** Every address a host name resolves to. The other real network call; it refuses under a test run for the same reason. */
export async function networkLookup(host: string): Promise<string[]> {
  if (process.env.VITEST) throw new Error(`no network in tests: DNS for ${host} (inject a fake lookup)`)
  return (await dnsLookupPromise(host, { all: true })).map(a => a.address)
}

/** The TXT records of a DNS name (an atproto handle's `_atproto.<handle>`). The third real network call; it refuses under
 *  a test run for the same reason. */
export async function networkResolveTxt(name: string): Promise<string[][]> {
  if (process.env.VITEST) throw new Error(`no network in tests: DNS TXT for ${name} (inject a fake resolveTxt)`)
  return dnsResolveTxt(name)
}
