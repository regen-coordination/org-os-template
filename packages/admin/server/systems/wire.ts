import { addressOf } from '../../lib/caip.mjs'
import type { DriverContext } from './driver.ts'

/** Calls in one JSON-RPC batch; public hosts refuse bigger ones. */
export const RPC_BATCH_LIMIT = 50

/** `to` is a bare address or a CAIP-10 account. */
export interface EthCall { to: string; data: string }
export type CallResult = { ok: true; data: string } | { ok: false; error: string }

type RpcAnswer = { id?: unknown; result?: unknown; error?: { message?: unknown } }

/** `eth_call`s on one chain, as JSON-RPC batches of at most `RPC_BATCH_LIMIT`, each led by `eth_blockNumber`. Answers
 *  are matched by id. A call the node reverted is `{ ok: false }`; a call with no answer fails the whole read. */
export async function ethCalls(ctx: DriverContext, chain: string, calls: EthCall[]): Promise<{ block: number; results: CallResult[] }> {
  const url = ctx.rpcUrl?.(chain) ?? null
  if (!url) throw new Error(`no RPC host is known for chain ${chain}`)
  if (!ctx.postJson) throw new Error('this reader was given no network access')
  const host = new URL(url).host
  const results: CallResult[] = []
  let block: number | null = null
  for (let from = 0; from < calls.length || from === 0; from += RPC_BATCH_LIMIT) {
    const chunk = calls.slice(from, from + RPC_BATCH_LIMIT)
    const batch = [
      { jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] },
      ...chunk.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: addressOf(c.to), data: c.data }, 'latest'] })),
    ]
    const answer = await ctx.postJson(url, batch)
    if (!Array.isArray(answer)) throw new Error(`${host} did not answer a JSON-RPC batch`)
    const byId = new Map<unknown, RpcAnswer>()
    for (const a of answer as RpcAnswer[]) if (a && typeof a === 'object') byId.set(a.id, a)
    const head = byId.get(0)
    if (!head || typeof head.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(head.result)) throw new Error(`${host} gave no answer for the block number`)
    if (block === null) block = Number(BigInt(head.result))
    for (let i = 0; i < chunk.length; i++) {
      const a = byId.get(i + 1)
      const n = from + i
      if (!a) throw new Error(`${host} gave no answer for call ${n + 1}`)
      if (a.error) results.push({ ok: false, error: typeof a.error.message === 'string' ? a.error.message : 'the node refused the call' })
      else if (typeof a.result === 'string') results.push({ ok: true, data: a.result })
      else throw new Error(`${host} gave no answer for call ${n + 1}`)
    }
    if (calls.length === 0) break
  }
  return { block: block ?? 0, results }
}

/** POST a GraphQL query. Any `errors` fail the read, even beside partial `data`. */
export async function graphql<T>(ctx: DriverContext, url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!ctx.postJson) throw new Error('this reader was given no network access')
  const host = new URL(url).host
  const answer = (await ctx.postJson(url, variables ? { query, variables } : { query })) as { data?: unknown; errors?: { message?: unknown }[] } | null
  if (answer && Array.isArray(answer.errors) && answer.errors.length > 0) {
    const m = answer.errors[0]?.message
    throw new Error(`${host} answered a GraphQL error: ${typeof m === 'string' ? m : 'no message'}`)
  }
  if (!answer || answer.data === undefined || answer.data === null) throw new Error(`${host} answered no data`)
  return answer.data as T
}
