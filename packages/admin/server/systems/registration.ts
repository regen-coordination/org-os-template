import { addressOf, caip10, isAddress } from '../../lib/caip.mjs'
import { decodeResult } from '../../lib/abi.mjs'
import { CHAINS, chainInfo } from './chains.ts'
import type { Driver, DriverContext, DriverRead } from './driver.ts'
import { ethCalls } from './wire.ts'

/** The selector of `daoURI()`, ERC-4824's registration getter (4byte.directory signature id 873770). */
export const DAO_URI_SELECTOR = '0x7034731b'

const hostsOf = (): string[] => [...new Set(Object.values(CHAINS).flatMap(c => [c.rpc, c.explorer]).filter((h): h is string => !!h))]

/** The ERC-4824 registration of a DAO: one `eth_call` for `daoURI()`. Reads only; nothing is signed or sent. */
export const daoUriRegistration: Driver = {
  name: 'daouri-registration',
  hosts: hostsOf(),
  minGapMs: 250,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    const chain = String(system.chain)
    const info = chainInfo(chain)
    if (!info) throw new Error(`a daoURI registration is read on chains this Hub knows (${Object.keys(CHAINS).join(', ')}); ${chain} is not one of them`)
    if (!info.rpc) throw new Error(`no RPC host is known for ${info.name}, so its daoURI registration cannot be read`)
    const address = String(system.address)
    if (!isAddress(address)) throw new Error(`${JSON.stringify(system.address)} is not an address`)
    const { results } = await ethCalls(ctx, chain, [{ to: address, data: DAO_URI_SELECTOR }])
    const r = results[0]!
    if (!r.ok) throw new Error(`daoURI() was refused by the node (${r.error})`)
    let daoURI: string | null = null
    if (r.data !== '0x') {
      let v: unknown[]
      try { v = decodeResult(['string'], r.data) } catch (err) { throw new Error(`daoURI() was answered in a shape this Hub does not read (${err instanceof Error ? err.message : String(err)})`) }
      daoURI = typeof v[0] === 'string' && v[0] !== '' ? v[0] : null
    }
    const account = caip10(chain, addressOf(address))
    return {
      ok: true, readAt: ctx.now().toISOString(),
      facts: { chain, account, daoURI },
      sections: [{ title: 'Registration', rows: [daoURI === null
        ? { cells: ['daoURI', 'no daoURI at this address'], attention: 'warn' as const }
        : { cells: ['daoURI', daoURI], refs: [account] }] }],
      open: info.explorer ? { url: `https://${info.explorer}/address/${address}`, embeddable: false } : null,
    }
  },
}
