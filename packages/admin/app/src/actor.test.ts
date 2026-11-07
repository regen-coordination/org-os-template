import { describe, it, expect } from 'vitest'
import { readOnlyReason, readOnlySentence } from './actor.ts'

describe('readOnlySentence', () => {
  // C10 (ledger; coordinator ruling): one read-only sentence, the band's (ReadOnly.tsx, C9). 0.6 said "Read-only: git
  // has no user.email set here; …" and "Read-only: your git email <addr> matches no member's handles.git in …"; the
  // band names the address in its title, so the sentence no longer does.
  it('says what to set when git has no user.email, in the band\'s words', () => {
    expect(readOnlySentence({ unknown: '' })).toBe('Read only: git has no address set here. Set user.email to one a member’s handles.git holds.')
  })

  it('says the address is not a member’s, in the band\'s words', () => {
    expect(readOnlySentence({ unknown: 'a@b.c' })).toBe('Read only: your git address is not a member’s.')
    expect(readOnlyReason({ unknown: 'a@b.c' })).toBe('your git address is not a member’s.')
  })

  it('has nothing to say to a known actor', () => {
    expect(readOnlySentence({ id: 'steward-a', name: 'Steward A', kind: 'person' })).toBeNull()
  })

  it('has nothing to say to a signed-in member (L5)', () => {
    const account = 'eip155:42220:0x0000000000000000000000000000000000000001'
    expect(readOnlySentence({ id: account, name: account, kind: 'person', via: 'siwe', account, hats: ['eip155:42220:13.1'], reading: { block: 1, readAt: '2026-10-29T10:00:00.000Z' } })).toBeNull()
  })
})
