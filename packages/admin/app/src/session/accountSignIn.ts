import { useCallback, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'

// The client half of the sign-in with a Bluesky or Certified account (refi-dao-os network app spec §5.1, §5.3; B3/B4):
// ask the Hub to start an OAuth round-trip, then leave for the account's own sign-in page, which comes back to the Hub.
// Pages say "Bluesky or Certified", never "AT Proto".

export type AccountPurpose = 'sign-in' | 'link' | 'add-node' | 'withdraw-node'
/** What else a start carries: the node (add, withdraw) and where to come back (another of the org's sites, judged by I6). */
export interface AccountStartOptions { node?: string; back?: string | null }
export interface AccountLink { did: string; handle: string; linked: string }

/** Where the last round-trip started (this tab's session storage): Certified's "Sign in with Atmosphere" sends a typed
 *  Bluesky handle to /sign-in/atmosphere, which goes back there with the handle filled in (AtmospherePage). */
export const STARTED_AT = 'hub.account-start'

/** A handle as a page may fill it in from `?handle=`: trimmed, no leading @, at most a handle's length; else ''. The
 *  server checks it again when a click starts the round-trip. */
export function handleParam(raw: string | null | undefined): string {
  const h = (raw ?? '').trim().replace(/^@/, '')
  return h.length <= 253 ? h : ''
}

/** How the browser leaves for the account's sign-in page: a full load (another site). An object, so a test can stand in. */
export const away = { go: (url: string): void => { window.location.assign(url) } }

async function answer<T>(res: Response): Promise<T> {
  const read = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof read.error === 'string' ? read.error : `HTTP ${res.status}`)
  return read as T
}

/** `POST /api/session/atproto/start`: the account's sign-in page to go to. No handle: Certified's sign-in. */
export async function startAccount(purpose: AccountPurpose, handle?: string, o: AccountStartOptions = {}): Promise<string> {
  const h = handle?.trim().replace(/^@/, '')
  const res = await fetch('/api/session/atproto/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ purpose, ...(o.node ? { node: o.node } : {}), ...(o.back ? { return: o.back } : {}), ...(h ? { handle: h } : {}) }),
  })
  return (await answer<{ url: string }>(res)).url
}

/** `GET /api/session/atproto/links`: the signed-in member's own linked accounts. */
export async function accountLinks(): Promise<AccountLink[]> {
  return (await answer<{ links: AccountLink[] }>(await fetch('/api/session/atproto/links'))).links
}

/** `DELETE /api/session/atproto/links/:did`: unlinks one of the member's own. */
export async function unlinkAccount(did: string): Promise<void> {
  const res = await fetch(`/api/session/atproto/links/${encodeURIComponent(did)}`, { method: 'DELETE' })
  if (!res.ok) await answer(res)
}

/** One start at a time; on success the browser leaves, on refusal the server's sentence. */
export function useAccountStart(purpose: AccountPurpose, o: AccountStartOptions = {}): { start(handle?: string): void; busy: boolean; error: string | null } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const going = useRef(false)
  const [path] = useLocation()
  const search = useSearch()
  const start = useCallback((handle?: string) => {
    if (going.current) return
    going.current = true
    try { sessionStorage.setItem(STARTED_AT, search ? `${path}?${search}` : path) } catch { /* storage off: /sign-in */ }
    setBusy(true); setError(null)
    startAccount(purpose, handle, o).then(url => { away.go(url) }, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'The sign-in could not be started.')
    }).finally(() => { going.current = false; setBusy(false) })
  }, [purpose, o.node, o.back, path, search])
  return { start, busy, error }
}
