import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { api, onUnauthorized, type SessionView } from '../api.ts'
import { parseSiweMessage } from '../../../lib/siwe.mjs'
import type { SignInState } from '../elements/signin/SignIn.tsx'
import { announce } from '../parts/live.tsx'
import { findProvider, requestAddress, signText } from './wallet.ts'

/** §4.5, with Q66's word: no provider in this browser. */
export const NO_WALLET = "No wallet was found in this browser. Open the Hub in a browser with a wallet, or in your wallet's own browser."
/** The wallet was asked to sign and declined (EIP-1193 4001). */
export const DECLINED = 'The wallet did not sign, so you are not signed in. Try again when you are ready.'
/** The server's message names another address than the wallet gave: it is not signed. */
export const OTHER_MESSAGE = 'The sign-in message names another address than the one the wallet gave, so it was not signed. Try again.'

export interface Session {
  /** GET /api/session; null while it is read, or when it could not be. */
  session: SessionView | null
  signIn(): Promise<void>
  cancel(): void
  signOut(): Promise<void>
  /** L4c SignIn's state: idle → waiting (the nonce asked, the wallet signing) → signed-in | not-member | failed. */
  state: SignInState
  /** The failed state's sentence: the server's, or the wallet's. */
  error: string | null
}

const SESSION_KEY = ['session'] as const
type Machine = { state: 'idle' | 'waiting' | 'not-member' | 'failed'; error: string | null }
const IDLE: Machine = { state: 'idle', error: null }

/** What a failed step says: the server's sentence as given; a wallet's refusal in the Hub's words; else the error's. */
function sentenceOf(err: unknown): string {
  const e = typeof err === 'object' && err !== null ? err as { code?: unknown; message?: unknown } : {}
  if (e.code === 4001) return DECLINED
  return typeof e.message === 'string' && e.message !== '' ? e.message : 'Signing in did not work. Try again.'
}

/** The session and the sign-in machine (L5 spec §11.1) over `GET /api/session`. The server writes the message; the
 *  wallet signs it; the client sends back only the nonce and the signature. Cancel returns to idle and drops whatever
 *  the wallet answers later: nothing more is posted, so the nonce is never spent. */
export function useSession(): Session {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const q = useQuery({ queryKey: SESSION_KEY, queryFn: api.session, retry: false, staleTime: 30_000 })
  const [machine, setMachine] = useState<Machine>(IDLE)
  const attempt = useRef(0)

  const signIn = useCallback(async () => {
    const mine = ++attempt.current
    const live = () => attempt.current === mine
    const fail = (error: string) => { if (live()) setMachine({ state: 'failed', error }) }
    setMachine({ state: 'waiting', error: null })
    try {
      const wallet = await findProvider()
      if (!live()) return
      if (!wallet) return fail(NO_WALLET)
      const address = await requestAddress(wallet)
      if (!live()) return
      const { nonce, message } = await api.sessionNonce(address)
      if (!live()) return
      // Read the message back before it is signed: it must name the address the wallet gave.
      const read = parseSiweMessage(message)
      if ('error' in read || read.address.toLowerCase() !== address.toLowerCase()) return fail(OTHER_MESSAGE)
      const signature = await signText(wallet, message, address)
      if (!live()) return
      const answer = await api.signIn(nonce, signature)
      if (answer.signedIn) {
        // Whatever was read before was read as someone else: read it again as this member.
        qc.setQueryData(SESSION_KEY, answer)
        void qc.invalidateQueries({ predicate: query => query.queryKey[0] !== SESSION_KEY[0] })
        if (live()) setMachine(IDLE)
      } else if (live()) setMachine({ state: 'not-member', error: null })
    } catch (err) {
      fail(sentenceOf(err))
    }
  }, [qc])

  const cancel = useCallback(() => {
    attempt.current++
    setMachine(IDLE)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.signOut()
    } catch (err) {
      announce(`Signing out did not work: ${sentenceOf(err)}`)
      return
    }
    attempt.current++
    setMachine(IDLE)
    navigate('/sign-in')
    // Nothing read as a member stays in memory; what is still drawn is read again (the session first, signed out).
    void qc.resetQueries()
  }, [qc, navigate])

  const session = q.data ?? null
  const state: SignInState = machine.state !== 'idle' ? machine.state : session?.signedIn ? 'signed-in' : 'idle'
  return { session, signIn, cancel, signOut, state, error: machine.error }
}

/** GET /api/session alone, without the sign-in machine: the identity and the notices read it. Null while it is read,
 *  or when it could not be. */
export function useSessionView(): SessionView | null {
  return useQuery({ queryKey: SESSION_KEY, queryFn: api.session, retry: false, staleTime: 30_000 }).data ?? null
}

/** Is `path` the sign-in page? */
export const isSignInPath = (path: string) => path === '/sign-in' || path.startsWith('/sign-in?')

/** In hosted mode a 401 from anywhere but sign-in itself sends the person to `/sign-in?next=<where they were>` (§11.1),
 *  when the session, read again now (never the cached one: it may have ended in another tab), is not live. A live
 *  session is not sent: past the grace it reads as public (§5.2) and the band says so; signing in again would only
 *  send the person back. A 401 in local mode sends nobody anywhere. */
function useSignInOn401(): void {
  const qc = useQueryClient()
  const [location, navigate] = useLocation()
  const search = useSearch()
  const here = useRef('')
  here.current = search ? `${location}?${search}` : location
  useEffect(() => onUnauthorized(() => {
    void (async () => {
      let view: SessionView
      try { view = await qc.fetchQuery({ queryKey: SESSION_KEY, queryFn: api.session, staleTime: 0 }) } catch { return }
      const at = here.current
      if (view.mode !== 'hosted' || view.signedIn || isSignInPath(at)) return
      navigate(`/sign-in?next=${encodeURIComponent(at)}`, { replace: true })
    })()
  }), [qc, navigate])
}

const SignOut = createContext<(() => Promise<void>) | null>(null)

/** The session for the whole Hub: Sign out for the identity menu while a session is live, and the hosted 401's way to
 *  sign-in. */
export function SessionProvider({ children }: { children?: ReactNode }) {
  const { session, signOut } = useSession()
  useSignInOn401()
  return createElement(SignOut.Provider, { value: session?.signedIn ? signOut : null }, children)
}

/** Sign out, when there is a session to end; null otherwise (a git member, a specimen outside SessionProvider). */
export function useSignOut(): (() => Promise<void>) | null {
  return useContext(SignOut)
}
