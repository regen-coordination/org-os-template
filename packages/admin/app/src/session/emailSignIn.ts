import { useCallback, useRef, useState } from 'react'
import type { Identity } from '../frame/sections.ts'

// The emailed-link sign-in's client half (Lane 3 Task 10): asking for a link, spending one, where to go after, and the
// words for a person's Roles. The page that draws the form is the sign-in page's (`SignIn` with `methods` and
// `onEmail`); this module holds what it calls, so it carries no wallet and no session machine of its own.

/** What `/sign-in` sends to the server as `return`: `return` (absolute, another of the org's sites) when given, else
 *  `next` (a path in this Hub, as the wallet sign-in reads it). The server judges it again (I6); null for neither. */
export function signInReturn(search: string): string | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const ret = q.get('return')
  if (ret) return ret
  const next = q.get('next')
  return next || null
}

export interface LinkAnswer { signedIn: true; return: string }
export class SignInRefused extends Error {
  constructor(message: string, public hint: string | null, public code: string | null) { super(message) }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const read = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new SignInRefused(typeof read.error === 'string' ? read.error : `HTTP ${res.status}`,
      typeof read.hint === 'string' ? read.hint : null, typeof read.code === 'string' ? read.code : null)
  }
  return read as T
}

/** `POST /api/session/email`: the server's sentence, the same for every address (I6). */
export async function askForLink(email: string, ret: string | null): Promise<string> {
  const answer = await post<{ sent: boolean; sentence: string }>('/api/session/email', { email, ...(ret ? { return: ret } : {}) })
  return answer.sentence
}

/** `POST /api/session/link`: spends the link once; the answer carries where to go. */
export const spendLink = (token: string): Promise<LinkAnswer> => post<LinkAnswer>('/api/session/link', { token })

/** Goes to `target` after sign-in: a path or a URL on this Hub through the router, any other host by a full load
 *  (the server has already judged it, and the client judged it too: anything else goes home). */
export function goTo(target: string, navigate: (path: string) => void, here: Location = window.location): void {
  let url: URL
  try { url = new URL(target, here.origin) } catch { navigate('/'); return }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') { navigate('/'); return }
  if (url.origin === here.origin) navigate(`${url.pathname}${url.search}${url.hash}`)
  else here.assign(url.href)
}

export type EmailState = 'idle' | 'sending' | 'sent' | 'failed'

/** The email form's state: one ask at a time; once sent, the server's sentence as given. */
export function useEmailSignIn(ret: string | null): { state: EmailState; sentence: string | null; error: string | null; send(email: string): void } {
  const [state, setState] = useState<EmailState>('idle')
  const [sentence, setSentence] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const send = useCallback((email: string) => {
    if (busy.current) return
    busy.current = true
    setState('sending'); setError(null)
    askForLink(email, ret).then(s => { setSentence(s); setState('sent') }, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'The link could not be asked for.'); setState('failed')
    }).finally(() => { busy.current = false })
  }, [ret])
  return { state, sentence, error, send }
}

/** I2's Roles as words; a governance role the org names is shown as its words too. */
const ROLE_WORDS: Record<string, string> = { steward: 'Steward', 'node-lead': 'Node Lead', 'network-member': 'Network Member' }
export const roleWord = (role: string): string =>
  ROLE_WORDS[role] ?? role.split(/[-_\s]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ')
export const roleWords = (roles: readonly string[]): string[] => roles.map(roleWord)

/** The identity menu's face for an email session: the person's name, their Roles as words, and no address. */
export function personIdentity(person: { name: string; roles: readonly string[] }): Identity {
  return { hatName: person.name, address: null, hatId: null, hats: [], roles: roleWords(person.roles) }
}
