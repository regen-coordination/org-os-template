import { useEffect, useRef, useState } from 'react'
import { useSearch } from 'wouter'
import { Note } from '../design/Note.tsx'
import { away } from '../session/accountSignIn.ts'

// /sign-out (refi-dao-os network app, final review of B8): signing out from another of the org's sites (the network
// site's menu links here). It ends the session (DELETE /api/session, which judges `return` by the I6 rule and says
// where to go), then goes there; with no return, to the Hub's home.

export default function SignOutPage() {
  const search = useSearch()
  const [error, setError] = useState<string | null>(null)
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    document.title = 'Signing out'
    const ret = new URLSearchParams(search).get('return')
    fetch(`/api/session${ret ? `?return=${encodeURIComponent(ret)}` : ''}`, { method: 'DELETE' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const read = res.status === 204 ? {} : (await res.json().catch(() => ({}))) as { next?: unknown }
        away.go(typeof read.next === 'string' ? read.next : '/')
      })
      .catch(() => setError('You could not be signed out just now. Try again in a minute.'))
  }, [search])
  return (
    <main className="signin-page">
      {error ? <Note state="error">{error}</Note> : <p className="signin-p">Signing you out…</p>}
    </main>
  )
}
