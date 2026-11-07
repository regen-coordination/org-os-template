import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STATUS_GROUPS, statusGroup } from '../../lib/decision-status.mjs'

const FILE = JSON.parse(readFileSync(new URL('../../../../schemas/decision-status.json', import.meta.url), 'utf8'))

describe('STATUS_GROUPS', () => {
  it('holds the five groups, in order', () => {
    expect(Object.keys(STATUS_GROUPS)).toEqual(['ratified', 'open', 'rejected', 'expired', 'withdrawn'])
  })
  it('is the table in schemas/decision-status.json', () => expect(STATUS_GROUPS).toEqual(FILE.groups))
  it('puts no word in two groups, and writes every word in lower case', () => {
    const words = Object.values(STATUS_GROUPS).flat()
    expect(new Set(words).size).toBe(words.length)
    for (const w of words) expect(w).toBe(w.toLowerCase())
  })
})

describe('statusGroup', () => {
  it.each([
    ['ratified', 'ratified'], ['approved', 'ratified'], ['adopted', 'ratified'], ['executed', 'ratified'], ['closed', 'ratified'],
    ['open', 'open'], ['proposed', 'open'], ['draft', 'open'], ['voting', 'open'],
    ['rejected', 'rejected'], ['preference-not-ratified', 'rejected'], ['expired', 'expired'], ['withdrawn', 'withdrawn'],
  ])('%s is %s', (word, group) => expect(statusGroup(word)).toBe(group))
  it('maps DECISIONS.md\'s own words: active and superseded are ratified', () => {
    expect(statusGroup('active')).toBe('ratified')
    expect(statusGroup('superseded')).toBe('ratified')
    expect(statusGroup('proposed')).toBe('open')
    expect(statusGroup('withdrawn')).toBe('withdrawn')
  })
  it('ignores case and surrounding spaces', () => expect(statusGroup('  Approved ')).toBe('ratified'))
  it('is null for a word the table does not hold: it shows as written', () => {
    expect(statusGroup('tabled')).toBeNull()
    expect(statusGroup('')).toBeNull()
  })
  it('is null for what is not a word', () => {
    expect(statusGroup(undefined)).toBeNull()
    expect(statusGroup(3)).toBeNull()
  })
})
