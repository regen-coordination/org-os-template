import { randomBytes } from 'node:crypto'
import { HttpError } from '../errors.ts'

export const PLAN_TTL_MS = 120_000

/** What the operator was shown and said yes to: the exact command, not the operation's name.
 *  The job that runs on this nonce runs this argv, even if the resource changed since. */
export interface PlanRecord {
  op: string; resource: string; params: Record<string, unknown>
  cmd: string; args: string[]; writes: string[]; timeoutMs: number
  /** Work done in the server process that still needs a confirmation (it reaches the network): the very function the
   *  plan gave, run instead of `cmd`, which is then ''. */
  inProcess?: (repo: string, signal: AbortSignal) => Promise<string>
}

/** Single-use confirmations. A page on another site can make the browser send a request here,
 *  but cannot read this server's answers, so it never learns a nonce: it cannot seat an agent. */
export class Plans {
  private issued = new Map<string, { plan: PlanRecord; expires: number }>()
  constructor(private ttlMs = PLAN_TTL_MS, private now: () => number = Date.now) {}

  issue(plan: PlanRecord): string {
    const t = this.now()
    for (const [k, v] of this.issued) if (v.expires < t) this.issued.delete(k)
    const nonce = randomBytes(24).toString('hex')
    this.issued.set(nonce, { plan, expires: t + this.ttlMs })
    return nonce
  }

  take(nonce: unknown): PlanRecord {
    const hit = typeof nonce === 'string' ? this.issued.get(nonce) : undefined
    if (typeof nonce === 'string') this.issued.delete(nonce)
    if (!hit || hit.expires < this.now()) {
      throw new HttpError(409, 'This confirmation was already used or has expired. Plan the operation again.')
    }
    return hit.plan
  }
}
