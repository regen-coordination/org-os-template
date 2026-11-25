import { useCallback, useRef, useState } from 'react'

// The client half of the sign-in with a Bluesky or Certified account (refi-dao-os network app spec §5.1, §5.3; B3/B4):
// ask the Hub to start an OAuth round-trip, then leave for the account's own sign-in page, which comes back to the Hub.
// Pages say "Bluesky or Certified", never "AT Proto".

export type AccountPurpose = 'sign-in' | 'link'
export interface AccountLink { did: string; handle: string; linked: string }

/** How the browser leaves for the account's sign-in page: a full load (another site). An object, so a test can stand in. */
export const away = { go: (url: string): void => { window.location.assign(url) } }

async function answer<T>(res: Response): Promise<T> {
  const read = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof read.error === 'string' ? read.error : `HTTP ${res.status}`)
  return read as T
}

/** `POST /api/session/atproto/start`: the account's sign-in page to go to. No handle: Certified's sign-in. */
export async function startAccount(purpose: AccountPurpose, handle?: string): Promise<string> {
  const h = handle?.trim().replace(/^@/, '')
  const res = await fetch('/api/session/atproto/start', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose, ...(h ? { handle: h } : {}) }),
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
export function useAccountStart(purpose: AccountPurpose): { start(handle?: string): void; busy: boolean; error: string | null } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const going = useRef(false)
  const start = useCallback((handle?: string) => {
    if (going.current) return
    going.current = true
    setBusy(true); setError(null)
    startAccount(purpose, handle).then(url => { away.go(url) }, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'The sign-in could not be started.')
    }).finally(() => { going.current = false; setBusy(false) })
  }, [purpose])
  return { start, busy, error }
}
