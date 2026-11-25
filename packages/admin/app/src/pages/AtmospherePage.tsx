import { useEffect, useRef } from 'react'
import { useLocation, useSearch } from 'wouter'
import { STARTED_AT, handleParam } from '../session/accountSignIn.ts'

// /sign-in/atmosphere: where Certified's sign-in page sends a Bluesky handle typed under its "Sign in with Atmosphere"
// button (the ePDS field named in server/session/atproto.ts, ?handle=). It starts nothing: a round-trip starts by a click on a Hub page
// (refi-dao-os network app, final review of B8). It goes back to the Hub page the round-trip started from (remembered
// in this tab when it started), the handle filled in, and the person clicks once more.

/** The pages that start a round-trip, and so the only ones to go back to. */
const STARTS = ['/sign-in', '/network-account', '/account-links']

/** Where to go: the remembered page when it is one of STARTS on this Hub, else /sign-in; with the handle, if any. */
export function atmosphereNext(stored: string | null, rawHandle: string | null): string {
  let at = new URL('/sign-in', 'https://hub.invalid')
  if (stored && stored.startsWith('/') && !stored.startsWith('//') && !stored.includes('\\')) {
    const u = new URL(stored, 'https://hub.invalid')
    if (u.origin === 'https://hub.invalid' && STARTS.includes(u.pathname)) at = u
  }
  const handle = handleParam(rawHandle)
  at.searchParams.delete('handle')
  if (handle !== '') at.searchParams.set('handle', handle)
  return `${at.pathname}${at.search}`
}

export default function AtmospherePage() {
  const search = useSearch()
  const [, navigate] = useLocation()
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    document.title = 'Sign in'
    let stored: string | null = null
    try { stored = sessionStorage.getItem(STARTED_AT) } catch { stored = null }
    navigate(atmosphereNext(stored, new URLSearchParams(search).get('handle')), { replace: true })
  }, [search, navigate])
  return (
    <main className="signin-page">
      <p className="signin-p">Taking you back…</p>
    </main>
  )
}
