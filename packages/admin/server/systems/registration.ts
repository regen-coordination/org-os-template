import { addressOf, caip10, checksumAddress, isAddress } from '../../lib/caip.mjs'
import { decodeResult, encodeCall } from '../../lib/abi.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { DAOURI_KEY, ENS_SIGNATURES, dnsEncode, namehash } from '../../lib/ens.mjs'
import { CHAINS, chainInfo } from './chains.ts'
import type { Driver, DriverContext, DriverRead } from './driver.ts'
import { ethCalls } from './wire.ts'

/** The selector of `daoURI()`, ERC-4824's registration getter (4byte.directory signature id 873770). */
export const DAO_URI_SELECTOR = '0x7034731b'

/** The ENS app on Sepolia, where a name's records are set by hand (spec §3). */
const ENS_APP = 'https://sepolia.app.ens.domains'

const hostsOf = (): string[] => [...new Set(Object.values(CHAINS).flatMap(c => [c.rpc, c.explorer]).filter((h): h is string => !!h))]

const SEPOLIA = 'eip155:11155111'

/** A registration by ENS text (L7-D13, Task 14): one `eth_call`, the Universal Resolver's `resolve(name, data)` with
 *  `data = text(namehash(name), "daouri")` (lib/ens.mjs cites the interface). Sepolia only: the Universal Resolver this
 *  Hub cites is Sepolia's (lib/deployments.mjs). */
async function readByEns(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
  const chain = String(system.chain)
  const name = String(system.ens)
  if (chain !== SEPOLIA || !Object.hasOwn(DEPLOYMENTS, chain)) throw new Error(`a daoURI registration by ENS text is read on Sepolia (${SEPOLIA}) only; this one names ${chain}`)
  const node = namehash(name) // throws a sentence on a name it does not read
  const data = encodeCall(ENS_SIGNATURES.resolve, [dnsEncode(name), encodeCall(ENS_SIGNATURES.text, [node, DAOURI_KEY])])
  const { results } = await ethCalls(ctx, chain, [{ to: DEPLOYMENTS[chain]!.ens.universalResolver, data }])
  const r = results[0]!
  if (!r.ok) throw new Error(`the Universal Resolver did not resolve ${name} (${r.error})`)
  let daoURI: string | null = null
  let resolver: string | null = null
  try {
    const [bytes, by] = decodeResult(['bytes', 'address'], r.data) as [string, string]
    const [text] = decodeResult(['string'], bytes) as [string]
    daoURI = text !== '' ? text : null
    resolver = caip10(chain, checksumAddress(by))
  } catch (err) {
    throw new Error(`the Universal Resolver answered ${name}'s daouri in a shape this Hub does not read (${err instanceof Error ? err.message : String(err)})`)
  }
  return {
    ok: true, readAt: ctx.now().toISOString(),
    facts: { chain, ens: name, resolver, daoURI },
    sections: [{ title: 'Registration', rows: [daoURI === null
      ? { cells: ['daoURI', `no daouri text record on ${name}`], attention: 'warn' as const }
      : { cells: ['daoURI', daoURI] }] }],
    open: { url: `${ENS_APP}/${name}`, embeddable: false },
  }
}

/** The ERC-4824 registration of a DAO: one `eth_call` for `daoURI()` at its address, or, with `ens`, for the name's
 *  `daouri` text record (L7-D13). Reads only; nothing is signed or sent. */
export const daoUriRegistration: Driver = {
  name: 'daouri-registration',
  hosts: hostsOf(),
  minGapMs: 250,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    if (typeof system.ens === 'string' && system.ens !== '') return readByEns(system, ctx)
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
