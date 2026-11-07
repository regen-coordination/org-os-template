/** The house fixtures every L4 group draws from (spec §17): Example DAO's public facts, the placeholder
 *  roles, and generated addresses. No real person's name; a neutral seal, never a DAO's logo. */

export const ORG = { name: 'Example DAO', mark: null } as const

/** The placeholders that stand in for people, with the monograms presence and mentions draw. */
export const ROLES = [
  { handle: 'council-steward', name: 'Council steward', monogram: 'CS' },
  { handle: 'steward-a', name: 'Steward A', monogram: 'SA' },
  { handle: 'steward-b', name: 'Steward B', monogram: 'SB' },
  { handle: 'ops-lead', name: 'Ops lead', monogram: 'OL' },
  { handle: 'treasury-steward', name: 'Treasury steward', monogram: 'TS' },
] as const

/** Example DAO's public Safe, and the seven chains it is deployed at the same address on. */
export const SAFE = '0x6AFFe5105DE869fE4A27b3353468eFb51a55343a'
export const SAFE_CHAINS = ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453', 'eip155:42220'] as const

/** A generated address for a fixture wearer or signer: deterministic, well formed, not a real account. It lives
 *  with the chain atoms (elements/atoms/chain.ts); the fixtures take it from there. */
export { fakeAddress } from '../../../elements/atoms/chain.ts'
