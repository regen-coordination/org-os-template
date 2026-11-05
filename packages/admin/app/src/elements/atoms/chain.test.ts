import { describe, it, expect } from 'vitest'
import { CHAIN_NAMES, TEST_CHAINS, caip10, chainName, exactPlaces, fakeAddress, formatAmount, isAddress, nativeUnit, shortAddress, unitsToDecimal } from './chain.ts'
import { SAFE, fakeAddress as fixtureAddress } from '../../test/fixtures/house/org.ts'

describe('addresses (spec §7.5)', () => {
  it('shortens an address to 0x + 4 … 4, in the case it was given', () => {
    expect(shortAddress('0x6AFFe5105DE869fE4A27b3353468eFb51a55343a')).toBe('0x6AFF…343a')
  })
  it('leaves anything that is not an address as it was given: never sliced into 0x… garbage', () => {
    expect(shortAddress('exampledao.eth')).toBe('exampledao.eth'); expect(shortAddress('42220 / 13')).toBe('42220 / 13'); expect(shortAddress('')).toBe('')
    const typo = `${SAFE}a` // 41 hex characters
    expect(shortAddress(typo)).toBe(typo)
    expect(shortAddress(SAFE.slice(0, 41))).toBe(SAFE.slice(0, 41))
    expect(shortAddress(`0X${SAFE.slice(2)}`)).toBe(`0X${SAFE.slice(2)}`)
    expect(shortAddress(` ${SAFE}`)).toBe(` ${SAFE}`)
  })
  it('knows an address: 0x and 40 hex characters, any case', () => {
    expect(isAddress(SAFE)).toBe(true)
    expect(isAddress(SAFE.toLowerCase())).toBe(true)
    for (const v of ['', 'exampledao.eth', '42220 / 13', `${SAFE}a`, SAFE.slice(0, 41), `0x${'g'.repeat(40)}`, `${SAFE}\n`]) expect(isAddress(v), v).toBe(false)
  })
  // B5: the outcome strip's transaction hash is a chip too (§9.6), shortened as an address is.
  it('shortens a 32-byte hash (a transaction or Safe hash) the same way, and nothing else of that kind', () => {
    const hash = `0x9e4b${'0'.repeat(56)}1c07`
    expect(shortAddress(hash)).toBe('0x9e4b…1c07')
    expect(shortAddress(`${hash}0`)).toBe(`${hash}0`)
    expect(shortAddress(hash.slice(0, 65))).toBe(hash.slice(0, 65))
    expect(isAddress(hash)).toBe(false)
  })
  it('writes the CAIP-10 id', () => {
    expect(caip10('eip155:42220', SAFE)).toBe(`eip155:42220:${SAFE}`)
  })
})

describe('chains (spec §7.6)', () => {
  it('names the eight chains of its fixed table, and gives an unknown chain its CAIP-2 id', () => {
    expect(chainName('eip155:42220')).toBe('Celo'); expect(chainName('eip155:999')).toBe('eip155:999')
    expect(CHAIN_NAMES).toEqual({
      'eip155:1': 'Ethereum', 'eip155:10': 'Optimism', 'eip155:42161': 'Arbitrum', 'eip155:100': 'Gnosis',
      'eip155:137': 'Polygon', 'eip155:8453': 'Base', 'eip155:42220': 'Celo', 'eip155:11155111': 'Sepolia',
    })
    expect(chainName('')).toBe('')
    expect(chainName('constructor')).toBe('constructor') // the table is a table, not an object's prototype
  })
  it('names each chain\'s native unit, and an unknown chain\'s as "native" (B5: a call\'s value)', () => {
    expect(nativeUnit('eip155:42220')).toBe('CELO'); expect(nativeUnit('eip155:100')).toBe('xDAI'); expect(nativeUnit('eip155:137')).toBe('POL')
    for (const c of ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:8453', 'eip155:11155111']) expect(nativeUnit(c), c).toBe('ETH')
    expect(nativeUnit('eip155:999')).toBe('native'); expect(nativeUnit('constructor')).toBe('native')
  })
  it('marks Sepolia as a test network, and nothing else', () => {
    expect([...TEST_CHAINS]).toEqual(['eip155:11155111'])
  })
})

describe('amounts (spec §7.7): string arithmetic, a true minus, truncated, grouped by locale', () => {
  it('groups and pads to the decimals it is given', () => {
    expect(formatAmount('1271', 2)).toBe('1,271.00'); expect(formatAmount('-3100.5', 2)).toBe('−3,100.50')
    expect(formatAmount('27561390.98', 2)).toBe('27,561,390.98')
    expect(formatAmount('3100', 0)).toBe('3,100')
    expect(formatAmount('0.5', 2)).toBe('0.50'); expect(formatAmount('.5', 2)).toBe('0.50')
  })
  it('keeps every digit of a number too large for a float, and truncates, never rounds', () => {
    expect(formatAmount('123456789012345678901234.129', 2)).toBe('123,456,789,012,345,678,901,234.12')
    expect(formatAmount('1.999', 2)).toBe('1.99')
    expect(formatAmount('1.999', 0)).toBe('1')
  })
  // L4b-M5: a non-zero value is never "0.00" — below the places it reads "< 0.01", an outgoing one "−< 0.01".
  it('writes a non-zero value that truncates to zero as below the smallest step, the true minus kept (L4b-M5)', () => {
    expect(formatAmount('0.005', 2)).toBe('< 0.01')
    expect(formatAmount('0.000000000000000001', 2)).toBe('< 0.01')
    expect(formatAmount('-0.001', 2)).toBe('−< 0.01')
    expect(formatAmount('.009', 2)).toBe('< 0.01')
  })
  it('keeps an exact zero, and a value at the step, as they are (L4b-M5)', () => {
    expect(formatAmount('0', 2)).toBe('0.00'); expect(formatAmount('0.000', 2)).toBe('0.00'); expect(formatAmount('-0', 0)).toBe('0')
    expect(formatAmount('-0.00', 2)).toBe('0.00')
    expect(formatAmount('0.01', 2)).toBe('0.01'); expect(formatAmount('0.019', 2)).toBe('0.01')
  })
  it('sets the threshold at the places given, in the locale\'s separator (L4b-M5)', () => {
    expect(formatAmount('0.00001', 4)).toBe('< 0.0001'); expect(formatAmount('0.0001', 4)).toBe('0.0001')
    expect(formatAmount('0.5', 0)).toBe('< 1')
    expect(formatAmount('0.001', 2, 'pt-BR')).toBe('< 0,01')
  })
  it('takes the separators from the locale', () => {
    expect(formatAmount('1271', 2, 'pt-BR')).toBe('1.271,00')
    expect(formatAmount('-1234567.891', 2, 'de-DE')).toBe('−1.234.567,89')
  })
  it('returns the value as given for places that are not a whole number from 0 (E-45)', () => {
    expect(formatAmount('1271.5', 1.5)).toBe('1271.5')
    expect(formatAmount('1271.5', -2)).toBe('1271.5')
    expect(formatAmount('1271.5', Number.NaN)).toBe('1271.5')
    expect(formatAmount('1271.5', 2)).toBe('1,271.50')
  })
  it('leaves a value that is not a decimal number as it was given', () => {
    for (const v of ['', 'abc', '1e18', '1,271.00', '--1', '1.2.3']) expect(formatAmount(v, 2), v).toBe(v)
  })
})

// L4b-M5: the prepared card shows every amount exactly — all its significant decimals, none padded, none cut.
describe('exactPlaces (L4b-M5): the places an amount needs to be shown exactly', () => {
  it('18 decimals: every one of them, grouped, BigInt-safe', () => {
    expect(exactPlaces('1234.567890123456789012')).toBe(18)
    expect(formatAmount('1234.567890123456789012', exactPlaces('1234.567890123456789012'))).toBe('1,234.567890123456789012')
    expect(formatAmount('0.000000000000000001', exactPlaces('0.000000000000000001'))).toBe('0.000000000000000001')
    const big = '9007199254740993.000000000000000001'
    expect(formatAmount(big, exactPlaces(big))).toBe('9,007,199,254,740,993.000000000000000001')
  })
  it('trailing zeros are not significant: no padding beyond the last digit that is', () => {
    expect(exactPlaces('3100.1250')).toBe(3)
    expect(formatAmount('3100.1250', exactPlaces('3100.1250'))).toBe('3,100.125')
  })
  it('a whole number has none', () => {
    expect(exactPlaces('1271')).toBe(0); expect(exactPlaces('1271.000')).toBe(0)
    expect(formatAmount('1271.000', exactPlaces('1271.000'))).toBe('1,271')
    expect(formatAmount('-3100.50', exactPlaces('-3100.50'))).toBe('−3,100.5')
  })
  it('a value that is not a decimal number needs none (formatAmount gives it back as it came)', () => {
    for (const v of ['', 'abc', '1e18']) expect(exactPlaces(v), v).toBe(0)
  })
})

// CC-8: on chain an amount is in base units; formatAmount takes a decimal string, so the two meet in unitsToDecimal.
describe('unitsToDecimal (CC-8): base units to the exact decimal string, BigInt, never a float', () => {
  it('an 18-decimal value is exact, and formats to 1,234.56', () => {
    expect(unitsToDecimal('1234567890123456789012', 18)).toBe('1234.567890123456789012')
    expect(formatAmount(unitsToDecimal('1234567890123456789012', 18), 2)).toBe('1,234.56')
  })
  it('keeps every digit of a value above 2^53', () => {
    expect(unitsToDecimal('9007199254740993', 0)).toBe('9007199254740993')
    expect(formatAmount(unitsToDecimal('9007199254740993', 0), 0)).toBe('9,007,199,254,740,993')
    expect(formatAmount(unitsToDecimal('9007199254740993000000000000000001', 18), 2)).toBe('9,007,199,254,740,993.00')
    expect(unitsToDecimal('9007199254740993000000000000000001', 18)).toBe('9007199254740993.000000000000000001')
  })
  it('pads a value smaller than one unit, drops trailing zeros, and keeps the sign', () => {
    expect(unitsToDecimal('1', 18)).toBe('0.000000000000000001')
    expect(unitsToDecimal('1271000000000000000000', 18)).toBe('1271')
    expect(unitsToDecimal('1500', 3)).toBe('1.5')
    expect(unitsToDecimal('-1500', 3)).toBe('-1.5')
    expect(unitsToDecimal('0', 18)).toBe('0'); expect(unitsToDecimal('-0', 6)).toBe('0'); expect(unitsToDecimal('000120', 2)).toBe('1.2')
  })
  it('leaves a value that is not a whole number of units as it was given', () => {
    for (const v of ['', 'abc', '1.5', '1e18', '0x10', ' 1', '--1']) expect(unitsToDecimal(v, 18), v).toBe(v)
  })
})

describe('fakeAddress (fixtures only)', () => {
  it('is deterministic, well formed and distinct', () => {
    expect(fakeAddress(1)).toMatch(/^0x[0-9a-f]{40}$/i); expect(fakeAddress(1)).toBe(fakeAddress(1)); expect(fakeAddress(1)).not.toBe(fakeAddress(2))
  })
  it('is the one the house fixtures re-export', () => {
    expect(fixtureAddress).toBe(fakeAddress)
  })
})
