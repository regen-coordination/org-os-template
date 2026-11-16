// packages/admin/server/deploy/prepare.ts
//
// A composition's deployment, prepared step by step (DAO-OS L7 spec §8.1–§8.3, Task 11): the committed composition (the
// Systems the viewer may read, PF-R172), the chain read at every place it predicts (server/deploy/state.ts, run through
// the SystemReader as the pseudo-driver `deploy`: Sepolia's RPC host, paced as every other read of it), the planner's
// steps (lib/deploy/plan.mjs), and each ready step prepared for its signer: an account step as its call and the
// explorer page of `to`; a Safe step as the Safe transaction that carries it (L2's prepareSafeTx, with the nonce and
// version read from the chain, L7-D15), the ready steps of one Safe on consecutive nonces (L2-R8). Reads only: nothing
// is signed, sent or written, and no lock is taken.
import { addressOf, caip10 } from '../../lib/caip.mjs'
import { compositionOf, type Composition } from '../../lib/compose.mjs'
import { planDeployment, type PlanHooks } from '../../lib/deploy/plan.mjs'
import { spaceSteps, type SpaceSettingsDraft } from '../../lib/deploy/space.mjs'
import { registrationSteps } from '../../lib/deploy/registration.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { SNAPSHOT_TESTNET_HOST } from '../systems/snapshot.ts'
import { CHAINS } from '../systems/chains.ts'
import { prepareSafeTx } from '../systems/safe.ts'
import type { DriverContext, PreparedStep } from '../systems/driver.ts'
import type { PseudoDriver, SystemReader } from '../systems/reader.ts'
import { isChainState, readChainState, type ChainState } from './state.ts'

const SEPOLIA = 'eip155:11155111'

/** The pseudo-driver the deploy reads run as: Sepolia's public RPC host (or the configured one, ORG_OS_RPC), paced as
 *  the hats-tree driver paces the same host (250 ms), with room for a composition's ~200 eth_calls per tree in batches. */
export const DEPLOY_DRIVER: PseudoDriver & { name: 'deploy'; hosts: string[]; minGapMs: number } = {
  // the Snapshot testnet hub too (L7 Task 13): a composed space is read there, by query only
  name: 'deploy', hosts: [CHAINS[SEPOLIA]!.rpc!, SNAPSHOT_TESTNET_HOST], minGapMs: 250, timeoutMs: () => 30_000,
}

/** The planner's hooks for steps 8 and 9 (L7 Tasks 13, 14): the Snapshot space, prepared as settings and links; the
 *  daoURI registered as the ENS name's `daouri` text record, `daoURI` being identity.daoURI (null: none yet). */
export function deployHooks(o: { daoURI: string | null } = { daoURI: null }): PlanHooks {
  return { space: spaceSteps, registration: registrationSteps(o.daoURI) }
}

/** identity.daoURI of the repository's federation.yaml, or null (no file, no identity, not text). */
export function daoUriOf(repo: string): string | null {
  try {
    const doc = parse(readFileSync(join(repo, 'federation.yaml'), 'utf8'), { schema: 'core' }) as { identity?: { daoURI?: unknown } } | null
    const uri = doc?.identity?.daoURI
    return typeof uri === 'string' && uri.trim() !== '' ? uri : null
  } catch {
    return null
  }
}

export const NOTHING_COMPOSED = 'Nothing is composed. Add a DAO template or compose on the canvas first.'
export const STAGED_ONLY = 'Apply or propose the composition first; deployments are prepared from what was decided.'

/** One step of the deployment as the Hub answers it (spec §8.3). `step` is L2's prepared step, on a ready step only: an
 *  account step's call with `signer: { kind: 'account', account: '' }` (the person running it chooses the account), a
 *  Safe step's call with the Safe as signer and `safe`, the Safe transaction. `link`: where it is run (the explorer page
 *  of `to` for an account step, the Safe app for a Safe step). `signer` says who signs whatever the status. A ready
 *  step's `differs` are warnings; a mismatch's, what the chain shows instead. */
export interface DeployStep {
  id: string
  system: string
  title: string
  status: 'ready' | 'waits' | 'done' | 'mismatch'
  waits?: string
  signer: { kind: 'account' } | { kind: 'safe'; system: string }
  step?: PreparedStep
  link?: string
  predicts: { kind: string; value: string; on?: string }[]
  differs?: string[]
  /** Step 8 (the Snapshot space) only: the settings and links to paste (spec §8.4); nothing to sign. */
  draft?: SpaceSettingsDraft
  /** A ready step a Safe signs: how many of its owners must sign (M-4), the threshold read from the Safe on chain (the
   *  composed one while it is not read), so the card's "n of N" is the server's, never the page's own guess. */
  threshold?: number
}
export interface DeployPlan { chain: string; composed: string[]; steps: DeployStep[]; readAt: string; problems: string[] }
/** Why there is no plan: nothing the viewer may read is composed, it is only staged, the viewer may read only part of
 *  it (PF-R184), or the chain could not be read. */
export type DeployRefusal = { code: 'NOTHING_COMPOSED' | 'STAGED_ONLY' | 'PART_HIDDEN' | 'READ_FAILED'; error: string }
export const isRefusal = (r: unknown): r is DeployRefusal => typeof r === 'object' && r !== null && 'code' in r && 'error' in r

/** The ids of the composed Systems among `records`, in their order. */
export function composedIds(records: Record<string, unknown>[]): string[] {
  return records.filter(r => (r.deployment as { status?: unknown } | undefined)?.status === 'composed').map(r => String(r.id))
}

/** The chain at every place `c` predicts, read through `reader` as `driver`, and when. A failed read is the node's
 *  sentence, naming its host only (I1). */
export async function readDeployment(c: Composition, reader: SystemReader, driver: PseudoDriver = DEPLOY_DRIVER):
  Promise<{ ok: true; state: ChainState; readAt: string } | { ok: false; error: string }> {
  let read: Awaited<ReturnType<typeof readChainState>>
  let readAt = ''
  try {
    read = await reader.readAs(driver, async ctx => { const r = await readChainState(c, ctx); readAt = ctx.now().toISOString(); return r })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return isChainState(read) ? { ok: true, state: read, readAt } : { ok: false, error: read.error }
}

/** The explorer page of an address on `chain`, or none when the Hub knows no explorer there. */
function explorerLink(chain: string, to: string): string | undefined {
  const host = Object.hasOwn(CHAINS, chain) ? CHAINS[chain]!.explorer : null
  return host ? `https://${host}/address/${addressOf(to)}` : undefined
}

/** prepareSafeTx's context when the nonce and version are given (`info`): it reads nothing, so it is given nothing. */
const NO_READS: DriverContext = {
  fetchJson: async () => { throw new Error('the deploy plan reads the Safe from the chain, not here') },
  now: () => new Date(), members: [],
}

/** The plan of `c` on the chain as `s` reads it, every ready step prepared for its signer. A Safe step that L2 would not
 *  prepare (a Safe version whose hash has no chain id, say) waits, with the refusal said as a problem too, and so does
 *  every later ready step of that Safe (fix wave M3): none is prepared on the nonce the one that waits would take. */
export async function stepsOf(c: Composition, s: ChainState, hooks: PlanHooks = {}): Promise<{ steps: DeployStep[]; problems: string[] }> {
  const planned = planDeployment(c, s, hooks)
  const problems = [...planned.problems]
  const offsets = new Map<string, number>()
  /** A Safe whose ready step could not be prepared: the title of that step. */
  const held = new Map<string, string>()
  const steps: DeployStep[] = []
  for (const p of planned.steps) {
    const { call, ...rest } = p
    const out: DeployStep = { ...rest }
    if (p.draft && p.status !== 'done') out.link = p.draft.links.create
    if (p.status === 'ready' && call) {
      const chainCall = { chain: c.chain, to: call.to, value: call.value, data: call.data, operation: call.operation, summary: call.summary }
      if (p.signer.kind === 'account') {
        out.step = { call: chainCall, signer: { kind: 'account', account: '' }, safe: null }
        const link = explorerLink(c.chain, call.to)
        if (link) out.link = link
      } else {
        const safeId = p.signer.system
        const read = s.safes[safeId]?.read
        const address = s.safes[safeId]?.predicted
        const offset = offsets.get(safeId) ?? 0
        const first = held.get(safeId)
        const prepared = first !== undefined
          ? { ok: false as const, held: true, error: `Waits for "${first}" to be prepared first: it takes the Safe's next nonce.` }
          : read && address
          ? await prepareSafeTx({ id: safeId, chain: c.chain, address }, c.chain, { to: addressOf(call.to), value: call.value, data: call.data, operation: call.operation },
            NO_READS, { info: { nonce: read.nonce, version: read.version }, nonceOffset: offset })
          : { ok: false as const, error: `the Safe ${safeId} is not read, so its transaction cannot be prepared.` }
        if (prepared.ok) {
          offsets.set(safeId, offset + 1)
          const composed = c.safes.find(x => x.id === safeId)
          const threshold = read?.threshold ?? (composed && !composed.deployed ? composed.threshold : undefined)
          if (typeof threshold === 'number') out.threshold = threshold
          out.step = { call: chainCall, signer: { kind: 'safe', account: caip10(c.chain, address!) }, safe: { payload: prepared.payload, ref: prepared.ref, link: prepared.link } }
          out.link = prepared.link
        } else {
          out.status = 'waits'
          out.waits = prepared.error
          out.predicts = []
          delete out.differs
          if (!('held' in prepared)) {
            held.set(safeId, p.title)
            if (!problems.includes(prepared.error)) problems.push(prepared.error)
          }
        }
      }
    }
    steps.push(out)
  }
  return { steps, problems }
}

/**
 * The deployment of the composition `opts.records` hold (the committed Systems the viewer may read), prepared: the
 * chain read through `reader` as `opts.driver` (the `deploy` pseudo-driver), then `stepsOf`. NOTHING_COMPOSED when
 * nothing in `records` is composed; READ_FAILED with the node's sentence when the chain could not be read. Writes
 * nothing. (`repo` is the plan's signature; the records are read by the route, through the viewer's gate.)
 */
export async function prepareDeployment(_repo: string, reader: SystemReader, opts: { records: Record<string, unknown>[]; driver?: PseudoDriver; hooks?: PlanHooks }):
  Promise<DeployPlan | DeployRefusal> {
  const c = compositionOf(opts.records)
  if (!c) return { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED }
  const read = await readDeployment(c, reader, opts.driver)
  if (!read.ok) return { code: 'READ_FAILED', error: read.error }
  const { steps, problems } = await stepsOf(c, read.state, opts.hooks ?? deployHooks({ daoURI: daoUriOf(_repo) }))
  return { chain: c.chain, composed: composedIds(opts.records), steps, readAt: read.readAt, problems }
}
