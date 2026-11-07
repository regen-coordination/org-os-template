import { describe, it, expect } from 'vitest'
import { validTrunkName, checkGovernance } from '../../lib/rules.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'

// The names come from the throwaway runs of the second review (proofs P, L1, L2): each is a name git
// itself accepts or one the platform must not build a ref from.
describe('validTrunkName', () => {
  it.each(['main', 'release/1.0', 'trunk-2', 'feat/ideation-system', 'a.b', 'v2', 'proposal-notes', 'feature/proposal/x', 'proposalsx'])('accepts %s', name => {
    expect(validTrunkName(name)).toBe(true)
  })
  it.each([
    ['+main', /begin with \+/],
    ['-x', /begin with -/],
    [':main', /may not hold/],
    ['a:b', /may not hold/],
    ['a b', /may not hold/],
    ['..x', /two dots/],
    ['x..y', /two dots/],
    ['a//b', /empty part/],
    ['x/', /end with \//],
    ['x.lock', /\.lock/],
    ['x.', /end with a dot/],
    ['refs/heads/main', /refs\//],
    ['HEAD', /reserved/],
    ['MERGE_HEAD', /reserved/],
    ['ORIG_HEAD', /reserved/],
    ['FETCH_HEAD', /reserved/],
    ['CHERRY_PICK_HEAD', /reserved/],
    ['a@{1}', /@\{/],
    ['*', /may not hold/],
    ['', /empty/],
    ['@', /@/],
    ['a/.hidden', /begin with a dot/],
    ['a\tb', /may not hold/],
    ['x\\y', /may not hold/],
    ['x[1]', /may not hold/],
    ['x^', /may not hold/],
    ['x~1', /may not hold/],
    ['x?', /may not hold/],
    ['ação', /letters, digits/],
    ['_x', /letters, digits/],
    ['@x', /letters, digits/],
    ['x{y}', /letters, digits/],
    // Review MEDIUM-C: the proposal branches' own names (proposal/<id>) are never the trunk.
    ['proposal/p-2026-10-18-001', /proposal branches/],
    ['proposal/x', /proposal branches/],
    ['proposals/x', /proposal branches/],
    ['proposal', /proposal branches/],
    ['Proposal/p-2026-10-18-001', /proposal branches/],
  ])('refuses %j, in words', (name, pattern) => {
    const answer = validTrunkName(name)
    expect(typeof answer, `${JSON.stringify(name)} must be refused`).toBe('string')
    expect(answer).toMatch(pattern)
  })
  it('a non-string is refused too', () => {
    expect(typeof validTrunkName(undefined as never)).toBe('string')
    expect(typeof validTrunkName(7 as never)).toBe('string')
  })
})

describe('governance.trunk', () => {
  const ctx = { members: [{ id: 'ana' }], systems: null, classes: ['records'] }
  it('checkGovernance reports an invalid trunk as an error naming the field', () => {
    const found = checkGovernance({ trunk: '+main' } as never, ctx).filter(p => p.level === 'error')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ path: 'trunk' })
    expect(found[0]!.message).toMatch(/trunk "\+main" cannot be the trunk: .*begin with \+/)
  })
  it('a good trunk, or none, says nothing', () => {
    expect(checkGovernance({ trunk: 'main' } as never, ctx)).toEqual([])
    expect(checkGovernance({} as never, ctx)).toEqual([])
    expect(checkGovernance({ trunk: null } as never, ctx)).toEqual([])
  })
  it('is in governance.schema.json as a string', () => {
    expect(validateEntry('governance', { trunk: 'main' }).filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('governance', { trunk: 7 }).filter(p => p.level === 'error').length).toBeGreaterThan(0)
  })
})
