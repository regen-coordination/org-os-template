import { fileURLToPath } from 'node:url'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { actorTrailer } from '../actor.ts'
import { commitDataPaths } from '../git.ts'
import { FINAL, type JobRecord, type JobStore } from '../state.ts'
import { Plans } from '../operations/plans.ts'
import type { Executor } from '../operations/executor.ts'
import type { Operation } from '../operations/catalogue.ts'
import type { Resource } from '../resources/types.ts'
import {
  CLAIM_RULE, MEMBERS_FILE, OWNER_CLAIM_COMMAND, changedSince, claimCandidates, claimRefusal, fingerprint, lockedOut, planClaim, readClaimState,
  slugOf, type ClaimState,
} from '../../lib/claim.mjs'

/** The script the plan fixes the argv of. It sits in the framework's scripts/, beside this package,
 *  and is run against the served repository whether or not that repository carries a copy. */
const CLAIM_SCRIPT = fileURLToPath(new URL('../../../../scripts/claim-handle.mjs', import.meta.url))

/** "A few seconds" (spec §5.4a): the script reads one file and renames one. */
export const CLAIM_TIMEOUT_MS = 10_000

export interface BootstrapDeps {
  repo: string
  jobs: JobStore
  executor: Executor
  /** The repository's one write lock (app.ts). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Tests run a stand-in script; the server uses the framework's own. */
  script?: string
}

type Target = { member: string } | { create: string }

const SHAPE = 'The body must be {"member": "<id>"} to claim a member who holds no git address, or {"create": {"name": "<name>"}} ' +
  'when no person is a member yet.'

async function readTarget(c: Context): Promise<Target> {
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const o = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  const create = o?.create && typeof o.create === 'object' && !Array.isArray(o.create) ? o.create as Record<string, unknown> : null
  // The owner's claim (L5 spec §8.1, C-9) is a command on the machine that holds the repository, never a request.
  if (o && (o.owner !== undefined || o.wallet !== undefined)) {
    throw new HttpError(400, `The owner's claim is not made here: it is a command, run on the machine that holds the repository: ${OWNER_CLAIM_COMMAND}`)
  }
  if (o && typeof o.member === 'string' && o.member !== '' && o.create === undefined) return { member: o.member }
  if (o && create && typeof create.name === 'string' && o.member === undefined) return { create: create.name }
  throw new HttpError(400, `${SHAPE}`)
}

const OP: Operation = {
  id: 'bootstrap.claim', kinds: [], label: () => 'Claim your git handle', effect: 'changes', network: false,
  timeoutMs: CLAIM_TIMEOUT_MS, params: { type: 'object', additionalProperties: false }, unavailable: () => null,
  plan: () => { throw new Error('the claim route plans its own run') }, refreshes: 'records',
}
const RESOURCE: Resource = {
  id: 'bootstrap:claim', kind: 'instance', board: 'systems', name: 'your git handle', status: null, attention: null,
  changed: null, facts: {}, source: null,
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The job once it has ended. The executor owns the process and its time limit; this only waits. */
async function ended(jobs: JobStore, id: string): Promise<JobRecord> {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS + 10_000
  for (;;) {
    const job = jobs.get(id)
    if (job && FINAL.includes(job.status)) return job
    if (Date.now() > deadline) throw new HttpError(500, 'The claim did not finish in time. Look at data/members.yaml before you try again.')
    await wait(25)
  }
}

/** W2a, the bootstrap claim (wizards spec §5.4a): its own routes, not a catalogue operation. The nonce
 *  is this route's own: a nonce from `/api/operations` is not accepted here, nor this one there. */
export function mountBootstrap(app: Hono, deps: BootstrapDeps): void {
  const { repo, jobs, executor, withLock } = deps
  const script = deps.script ?? CLAIM_SCRIPT
  const plans = new Plans()

  /** The question asked at plan, at confirm and, by the script, again at the file. */
  const refuse = (why: string): never => { throw new HttpError(409, why) }

  app.get('/api/bootstrap/claim', async c => {
    const state = await readClaimState(repo)
    const { candidates, canCreate } = claimCandidates(state)
    let refusal = claimRefusal(state)
    if (refusal === null && candidates.length === 0 && !canCreate) {
      refusal = `Every person in ${MEMBERS_FILE} already has a git address. Another address is added through the change loop, by someone it can name, not by a claim.`
    }
    // Locked out (L5 spec §8.1): the page shows the owner's command instead of a claim.
    const locked = lockedOut(state)
    return c.json({
      available: refusal === null, refusal, address: state.address, candidates: refusal === null ? candidates : [], canCreate: refusal === null && canCreate,
      rule: CLAIM_RULE, lockedOut: locked, command: locked ? OWNER_CLAIM_COMMAND : null,
    })
  })

  app.post('/api/bootstrap/claim/plan', async c => {
    const target = await readTarget(c)
    const state = await readClaimState(repo, target)
    const plan = planClaim(state)
    if (plan.refusal !== null) return refuse(plan.refusal)
    const args = [script, '--repo', repo, '--address', plan.address, ...('member' in target ? ['--member', target.member] : ['--create', target.create.trim()])]
    const writes = [MEMBERS_FILE]
    const trailers = { 'Org-Actor': actorTrailer({ unknown: plan.address }), 'Org-Rule': CLAIM_RULE }
    const nonce = plans.issue({
      op: OP.id, resource: RESOURCE.id, params: { target, fingerprint: fingerprint(state) },
      cmd: process.execPath, args, writes, timeoutMs: CLAIM_TIMEOUT_MS,
    })
    return c.json({
      nonce, expiresInMs: 120_000,
      review: {
        address: plan.address, file: MEMBERS_FILE, lines: plan.lines,
        member: { id: plan.id, name: plan.name ?? memberName(state, plan.id!), created: plan.created },
        commit: { message: commitMessage(plan.id!, plan.created), trailers },
        note: 'This file is committed. If this repository is public, the address becomes public. Use your noreply address if you prefer.',
        cmd: process.execPath, args, writes, timeoutMs: CLAIM_TIMEOUT_MS, network: false,
      },
    })
  })

  app.post('/api/bootstrap/claim/confirm', async c => {
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const nonce = body && typeof body === 'object' ? (body as Record<string, unknown>).nonce : undefined
    const plan = plans.take(nonce) // single use: taken whether or not what follows succeeds
    const { target, fingerprint: then } = plan.params as { target: Target; fingerprint: ReturnType<typeof fingerprint> }
    return withLock(async () => {
      // Before anything is written: every refusal, on freshly read files and a freshly read address.
      const state = await readClaimState(repo, target)
      const changed = changedSince(then, fingerprint(state))
      const why = claimRefusal(state)
      if (changed.length > 0 || why !== null) {
        const what = changed.length > 0 ? `${changed.join(' and ')} changed` : why
        return refuse(`Something changed since you reviewed this: ${what}. Nothing was written. Prepare it again.`)
      }
      const job = await ended(jobs, executor.submit({ op: OP, resource: RESOURCE, planned: { cmd: plan.cmd, args: plan.args, writes: plan.writes } }).id)
      // The executor never commits and reports what changed: commit only when that is exactly the one declared file.
      if (job.status !== 'ok') throw new HttpError(500, job.sentence ?? `The claim ended ${job.status}.`)
      if (job.changed.length !== 1 || job.changed[0] !== MEMBERS_FILE) {
        throw new HttpError(500, `The claim finished, but it changed ${job.changed.length === 0 ? 'nothing' : job.changed.join(', ')} where ${MEMBERS_FILE} was expected. Nothing was committed; look at the files before you try again.`)
      }
      const id = 'member' in target ? target.member : slugOf(target.create)
      const actor = actorTrailer({ unknown: state.address!.trim() })
      let commit: string
      try {
        commit = await commitDataPaths(repo, [MEMBERS_FILE], commitMessage(id, 'create' in target), { actor, rule: CLAIM_RULE })
      } catch (err) {
        const said = err instanceof Error ? err.message : String(err)
        // The file is not put back: the person decides, with the line in front of them.
        throw new HttpError(503, `Written, not committed: ${MEMBERS_FILE} has the new line, but git refused the commit (${said.split('\n')[0]}). ` +
          'Look at it with git diff, then commit it or put it back by hand.', 'WRITTEN_NOT_COMMITTED')
      }
      return c.json({ ok: true, commit, member: { id }, changed: job.changed, job: { id: job.id, status: job.status }, trailers: { 'Org-Actor': actor, 'Org-Rule': CLAIM_RULE } })
    })
  })
}

const commitMessage = (id: string, created: boolean) =>
  created ? `admin(members): add ${id} with its git handle` : `admin(members): claim the git handle for ${id}`

function memberName(state: ClaimState, id: string): string {
  return claimCandidates(state).candidates.find(m => m.id === id)?.name ?? id
}
