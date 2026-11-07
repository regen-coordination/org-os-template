import type { SiweFields } from '../../lib/siwe.mjs'

/** At most this many sign-ins wait for a signature at once (L5 spec §4.2). */
export const NONCE_LIMIT = 1000
/** §4.2's refusal when that many wait: no one's is evicted. */
export const TOO_MANY = 'Too many sign-ins are waiting. Try again in a minute.'

/** A message the server built and keeps until it is signed: its exact text, its fields, its expiry (ms). */
export interface Waiting { message: string; fields: SiweFields; expires: number }

/** The nonces waiting for a signature (§4.2): in memory, single use, at most `NONCE_LIMIT`. A restart forgets them,
 *  and a signature over a forgotten nonce is refused like an unknown one. */
export class Nonces {
  private readonly waiting = new Map<string, Waiting>()
  constructor(private readonly now: () => Date) {}

  /** Keeps `w` under `nonce`; false when `NONCE_LIMIT` unexpired ones already wait. */
  add(nonce: string, w: Waiting): boolean {
    const at = this.now().getTime()
    for (const [n, kept] of this.waiting) if (kept.expires <= at) this.waiting.delete(n)
    if (this.waiting.size >= NONCE_LIMIT) return false
    this.waiting.set(nonce, w)
    return true
  }

  /** Spends `nonce`, whatever follows (§4.3 step 1): the message it was kept with, or why there is none. */
  take(nonce: string): Waiting | 'unknown' | 'expired' {
    const w = this.waiting.get(nonce)
    if (!w) return 'unknown'
    this.waiting.delete(nonce)
    return w.expires <= this.now().getTime() ? 'expired' : w
  }
}
