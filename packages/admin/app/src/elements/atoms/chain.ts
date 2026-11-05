/** The chain atoms' pure helpers (spec §7.5–7.7): what an address, a chain and an amount read as. Nothing
 *  here guesses: a value that is not what it should be is given back as it came, never sliced or rounded. */

/** The fixed table of chain names (§7.6), by CAIP-2 id. Never a brand's logo or colour, only its name. */
export const CHAIN_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'eip155:1': 'Ethereum', 'eip155:10': 'Optimism', 'eip155:42161': 'Arbitrum', 'eip155:100': 'Gnosis',
  'eip155:137': 'Polygon', 'eip155:8453': 'Base', 'eip155:42220': 'Celo', 'eip155:11155111': 'Sepolia',
})

/** Each chain's native unit, what a call's `value` moves (as server/systems/chains.ts names them; the client does
 *  not import the server's table). Every one of them has 18 decimals. */
const NATIVE_UNITS: Readonly<Record<string, string>> = Object.freeze({
  'eip155:1': 'ETH', 'eip155:10': 'ETH', 'eip155:42161': 'ETH', 'eip155:100': 'xDAI',
  'eip155:137': 'POL', 'eip155:8453': 'ETH', 'eip155:42220': 'CELO', 'eip155:11155111': 'ETH',
})

/** A chain's native unit; an unknown chain's is "native". */
export function nativeUnit(caip2: string): string {
  return Object.hasOwn(NATIVE_UNITS, caip2) ? NATIVE_UNITS[caip2]! : 'native'
}

/** The test networks among them: their chip is dashed and says "· test". */
export const TEST_CHAINS: ReadonlySet<string> = new Set(['eip155:11155111'])

/** A chain's name; an unknown chain is its CAIP-2 id. */
export function chainName(caip2: string): string {
  return Object.hasOwn(CHAIN_NAMES, caip2) ? CHAIN_NAMES[caip2]! : caip2
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** An EVM address: `0x` and 40 hex characters, in any case. */
export function isAddress(v: string): boolean {
  return ADDRESS.test(v)
}

const HASH = /^0x[0-9a-fA-F]{64}$/

/** An address as a chip shows it: `0x` + the first 4 … the last 4, in the case it was given (`0x6AFF…343a`); a
 *  32-byte hash (a transaction's, a Safe transaction's) the same way, for the outcome strip's chip (§9.6).
 *  Anything else (an ENS name, `42220 / 13`, a 41-character typo, an empty string) is returned unchanged. */
export function shortAddress(v: string): string {
  return isAddress(v) || HASH.test(v) ? `${v.slice(0, 6)}…${v.slice(-4)}` : v
}

/** The CAIP-10 account id: `eip155:42220:0x…`. */
export function caip10(caip2: string, address: string): string {
  return `${caip2}:${address}`
}

const DECIMAL = /^([-+]?)(\d*)(?:\.(\d*))?$/
const MINUS = '−'

/** An on-chain amount, given as its exact decimal string, written for a person (§7.7): grouped with the
 *  locale's separators, `decimals` places (padded, and truncated, never rounded: what is shown is never more
 *  than what is there), a true minus for what goes out. The integer part is a BigInt, so no digit of a
 *  token's 18-decimal balance is lost to a float; Intl only groups it and names the decimal separator, in
 *  Latin digits. A non-zero value that truncates to zero is never "0.00": it reads as below the smallest step
 *  shown, "< 0.01" at 2 places ("< 0.0001" at 4, "< 1" at none), an outgoing one "−< 0.01" (L4b-M5); an exact
 *  zero is "0.00". A value that is not a plain decimal number is returned as given. */
export function formatAmount(value: string, decimals: number, locale?: string): string {
  const m = DECIMAL.exec(value)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return value
  // A count of places that is not a whole number from 0 is no way to show it: the value as given (E-45).
  if (!Number.isInteger(decimals) || decimals < 0) return value
  const [, sign, int, frac = ''] = m
  const places = decimals
  const kept = frac.slice(0, places).padEnd(places, '0')
  const whole = BigInt(int || '0')
  const fmt = new Intl.NumberFormat(locale, { numberingSystem: 'latn' })
  const decimal = fmt.formatToParts(1.5).find(p => p.type === 'decimal')?.value ?? '.'
  const text = fmt.format(whole) + (places > 0 ? `${decimal}${kept}` : '')
  const zero = whole === 0n && !/[1-9]/.test(kept)
  if (zero && /[1-9]/.test(frac)) {
    const step = places > 0 ? `0${decimal}${'1'.padStart(places, '0')}` : '1'
    return `${sign === '-' ? MINUS : ''}< ${step}`
  }
  return sign === '-' && !zero ? `${MINUS}${text}` : text
}

/** The places that show `value` exactly (L4b-M5): its fraction's significant digits, trailing zeros not counted;
 *  0 for a whole number, or for a value that is not a decimal number. `formatAmount(value, exactPlaces(value))` is
 *  the exact form the prepared-transaction card draws: every significant decimal, grouped, nothing padded or cut. */
export function exactPlaces(value: string): number {
  const m = DECIMAL.exec(value)
  return m ? (m[3] ?? '').replace(/0+$/, '').length : 0
}

const UNITS = /^(-?)(\d+)$/

/** An on-chain amount in base units (`1271000000000000000000`) as the exact decimal string `formatAmount` takes
 *  (`1271`), for a token of `tokenDecimals` decimals (CC-8). BigInt arithmetic, never a float: no digit is lost
 *  above 2^53. Trailing zeros of the fraction are dropped; a negative keeps its sign. A value that is not a whole
 *  number of units is returned as given. */
export function unitsToDecimal(raw: string, tokenDecimals: number): string {
  const m = UNITS.exec(raw)
  if (!m) return raw
  const places = Math.max(0, Math.trunc(tokenDecimals))
  const digits = BigInt(m[2]!).toString()
  const sign = m[1] === '-' && digits !== '0' ? '-' : ''
  if (places === 0) return sign + digits
  const padded = digits.padStart(places + 1, '0')
  const frac = padded.slice(-places).replace(/0+$/, '')
  return `${sign}${padded.slice(0, -places)}${frac ? `.${frac}` : ''}`
}

/** A generated address for a fixture wearer or signer (spec §17): deterministic in `n`, well formed, and not a
 *  real account. Fixtures only; the house fixtures (test/fixtures/house/org.ts) re-export it. */
export function fakeAddress(n: number): string {
  let x = (Math.imul(n + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  let hex = ''
  while (hex.length < 40) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0
    hex += x.toString(16).padStart(8, '0')
  }
  return `0x${hex.slice(0, 40)}`
}
