// The two-way handle check (refi-dao-os network app spec §5.4; plan task B5): a TypeScript port of refi-dao-os
// scripts/nodes/check-network.mjs `checkEntry` (Dec 9 spec §5.4), so the Hub and the weekly script check an account
// the same way. An account passes only when its handle resolves to its DID and the DID document names the handle back.
// It also reads which apps hold a profile for the account (`on`). Read-only towards AT Proto: nothing is written to any
// service. Nothing here throws: a resolver that is down or answers junk is simply not a pass.
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises'

export const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]+)$/
/** A lowercase hostname with at least two labels (handles are DNS names; the check lowercases what people type). */
export const HANDLE_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/
/** AT Proto's handle for an account whose handle does not check out both ways. */
const HANDLE_INVALID = 'handle.invalid'
const APPVIEW = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle='
const APP_COLLECTIONS: Record<string, string[]> = {
  bluesky: ['app.bsky.actor.profile'],
  certified: ['app.certified.actor.profile', 'app.certified.actor.organization'],
}

export interface CheckDeps {
  fetchImpl: (url: string) => Promise<Response>
  resolveTxt: (name: string) => Promise<string[][]>
}
export const defaultCheckDeps: CheckDeps = {
  fetchImpl: url => fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json, text/plain' } }),
  resolveTxt: dnsResolveTxt,
}
export interface CheckResult { check: 'pass' | 'fail'; did: string | undefined; handle: string; on: string[]; reason: string | null }

/** A bare handle, an @handle, an at:// address, or a Bluesky or Certified profile link by handle (with or without
 *  https:// and www.) → a lowercase handle; anything else, a DID included, → null. */
export function normalizeHandle(text: unknown): string | null {
  const h = String(text ?? '').trim()
    .replace(/^at:\/\//i, '')
    .replace(/^(https?:\/\/)?(www\.)?(bsky|certified)\.app\/profile\//i, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '')
    .toLowerCase()
  return HANDLE_RE.test(h) ? h : null
}

async function getJson(fetchImpl: CheckDeps['fetchImpl'], url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetchImpl(url)
    if (!r.ok) return null
    const body: unknown = await r.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch { return null }
}

/** The protocol's own resolution first (DNS TXT, then HTTPS .well-known); the public AppView only as a last resort. */
export async function resolveHandle(handle: string, deps: CheckDeps = defaultCheckDeps): Promise<string | null> {
  try {
    const records = await deps.resolveTxt(`_atproto.${handle}`)
    const did = records.map(parts => parts.join('')).find(s => s.startsWith('did='))?.slice(4)
    if (did && DID_RE.test(did)) return did
  } catch { /* no TXT record */ }
  try {
    const r = await deps.fetchImpl(`https://${handle}/.well-known/atproto-did`)
    if (r.ok) { const did = (await r.text()).trim(); if (DID_RE.test(did)) return did }
  } catch { /* no well-known */ }
  const viaAppView = await getJson(deps.fetchImpl, `${APPVIEW}${encodeURIComponent(handle)}`)
  return typeof viaAppView?.did === 'string' && DID_RE.test(viaAppView.did) ? viaAppView.did : null
}

export async function fetchDidDoc(did: string, deps: CheckDeps = defaultCheckDeps): Promise<Record<string, unknown> | null> {
  if (did.startsWith('did:plc:')) return getJson(deps.fetchImpl, `https://plc.directory/${did}`)
  if (did.startsWith('did:web:')) return getJson(deps.fetchImpl, `https://${did.slice('did:web:'.length)}/.well-known/did.json`)
  return null
}

/** check-network.mjs `checkEntry`: the account passes, or fails with the reason. A handle that is not a handle
 *  (`handle.invalid`, junk) fails at once, without a network call. */
export async function checkAccount(rec: { handle: string; did?: string }, deps: CheckDeps = defaultCheckDeps): Promise<CheckResult> {
  const normal = normalizeHandle(rec.handle)
  const handle = normal ?? String(rec.handle ?? '')
  const fail = (reason: string, did: string | undefined = rec.did): CheckResult => ({ check: 'fail', did, handle, on: [], reason })
  if (!normal || normal === HANDLE_INVALID) return fail('the account has no checked handle')
  const resolved = await resolveHandle(handle, deps)
  if (!resolved) return fail('handle does not resolve', rec.did ?? undefined)
  if (rec.did && rec.did !== resolved) return fail('handle resolves to another DID')
  const doc = await fetchDidDoc(resolved, deps)
  if (!doc) return fail('DID document not found', resolved)
  if (!(Array.isArray(doc.alsoKnownAs) && doc.alsoKnownAs.includes(`at://${handle}`))) return fail('DID document does not name the handle', resolved)
  const services = Array.isArray(doc.service) ? doc.service as { id?: unknown; serviceEndpoint?: unknown }[] : []
  const pds = services.find(s => typeof s?.id === 'string' && s.id.endsWith('#atproto_pds'))?.serviceEndpoint
  const described = typeof pds === 'string' && /^https:\/\//.test(pds)
    ? await getJson(deps.fetchImpl, `${pds.replace(/\/+$/, '')}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(resolved)}`)
    : null
  const collections = described?.collections
  if (!Array.isArray(collections)) return fail('the account\'s host did not answer', resolved)
  const on = Object.keys(APP_COLLECTIONS).filter(app => APP_COLLECTIONS[app]!.some(c => collections.includes(c)))
  return { check: 'pass', did: resolved, handle, on, reason: null }
}
