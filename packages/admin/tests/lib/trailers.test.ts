import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { TRAILER, HOUSE_IDENT, withTrailers, parseTrailers } from '../../lib/trailers.mjs'

/** What git itself reads as the message's trailers. */
const gitParse = (message: string) => execSync('git interpret-trailers --parse', { input: message }).toString()

describe('TRAILER', () => {
  it('names the five trailers of F1 §3.6, and L5 §6.4\'s Org-Hat after Org-Rule', () => {
    expect(TRAILER).toEqual({ actor: 'Org-Actor', change: 'Org-Change', rule: 'Org-Rule', hat: 'Org-Hat', proposal: 'Org-Proposal', decision: 'Org-Decision' })
    expect(Object.keys(TRAILER)).toEqual(['actor', 'change', 'rule', 'hat', 'proposal', 'decision'])
  })
})

describe('HOUSE_IDENT (L5 spec §6.4)', () => {
  it('is the constant the house commits a signed-in actor\'s writes as', () => {
    expect(HOUSE_IDENT).toEqual({ name: 'org-os house', email: 'house@org-os.invalid' })
    expect(Object.isFrozen(HOUSE_IDENT)).toBe(true)
  })
})

describe('withTrailers', () => {
  it('appends them after a blank line, in TRAILER order whatever order they come in', () => {
    expect(withTrailers('admin(projects): update p1', { rule: 'solo/direct', actor: 'github:ana-example' }))
      .toBe('admin(projects): update p1\n\nOrg-Actor: github:ana-example\nOrg-Rule: solo/direct')
  })
  it('writes all five, in order', () => {
    expect(withTrailers('m', { decision: 'gov-1', proposal: 'p-1', rule: 'governance/approve', change: 'chg_1', actor: 'ana' }))
      .toBe('m\n\nOrg-Actor: ana\nOrg-Change: chg_1\nOrg-Rule: governance/approve\nOrg-Proposal: p-1\nOrg-Decision: gov-1')
  })
  it('writes Org-Hat after Org-Rule and before Org-Proposal, and reads it back', () => {
    const hat = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000 @31000123'
    const message = withTrailers('m', { proposal: 'p-1', hat, rule: 'records/direct', actor: 'ana' })
    expect(message).toBe(`m\n\nOrg-Actor: ana\nOrg-Rule: records/direct\nOrg-Hat: ${hat}\nOrg-Proposal: p-1`)
    expect(parseTrailers(message)).toEqual({ actor: 'ana', rule: 'records/direct', hat, proposal: 'p-1' })
  })
  it('leaves out values that are not given', () => {
    expect(withTrailers('m', { actor: 'ana', change: undefined })).toBe('m\n\nOrg-Actor: ana')
  })
  it('leaves the message as it is when there are none', () => {
    expect(withTrailers('m')).toBe('m')
    expect(withTrailers('m', {})).toBe('m')
  })
  it('keeps each value on its one line, so a value cannot add a trailer', () => {
    expect(withTrailers('m', { actor: 'unknown <a@b.org>\nOrg-Rule: forged' })).toBe('m\n\nOrg-Actor: unknown <a@b.org> Org-Rule: forged')
  })
  it('is what git reads back with git interpret-trailers --parse', () => {
    const message = withTrailers('admin(members): update ana\n\nA body line.', { actor: 'unknown <ana@example.org>', change: 'chg_01J', rule: 'solo/direct' })
    expect(gitParse(message)).toBe('Org-Actor: unknown <ana@example.org>\nOrg-Change: chg_01J\nOrg-Rule: solo/direct\n')
  })
})

describe('parseTrailers', () => {
  it('is the inverse of withTrailers', () => {
    const values = { actor: 'github:ana-example', change: 'chg_1', rule: 'solo/direct' }
    expect(parseTrailers(withTrailers('admin(projects): update p1', values))).toEqual(values)
  })
  it('finds none in a subject alone, as git does', () => expect(parseTrailers('Org-Actor: ana')).toEqual({}))
  it('reads only Org-* trailers, whatever their case', () => {
    expect(parseTrailers('m\n\nCo-Authored-By: X <x@example.org>\norg-actor: ana')).toEqual({ actor: 'ana' })
  })
  it('reads the last paragraph only', () => {
    expect(parseTrailers('m\n\nOrg-Actor: in-the-body\n\nOrg-Rule: solo/direct')).toEqual({ rule: 'solo/direct' })
  })
})
