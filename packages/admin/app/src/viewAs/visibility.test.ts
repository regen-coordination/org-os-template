import { describe, it, expect } from 'vitest'
import { FIXTURE_SOURCE, canSee, readersWithin, type Visibility, type Viewer } from './visibility.ts'

const PUBLIC: Visibility = { level: 'public' }
const MEMBERS: Visibility = { level: 'members' }
const hat = (id: string): Visibility => ({ level: 'hat', hat: id, name: FIXTURE_SOURCE.hats().find(h => h.hat === id)!.name })
const wearer = (id: string): Viewer => ({ as: 'hat', hat: id, name: FIXTURE_SOURCE.hats().find(h => h.hat === id)!.name })
const ALL: Visibility[] = [PUBLIC, MEMBERS, hat('top'), hat('council'), hat('ops'), hat('treasury')]
const sees = (v: Viewer) => ALL.filter(x => canSee(v, x, FIXTURE_SOURCE))

describe('who sees what (L4-R7, CONTEXT "Visibility")', () => {
  it('you see everything', () => {
    expect(sees({ as: 'you' })).toEqual(ALL)
  })

  it('public sees only public', () => {
    expect(sees({ as: 'public' })).toEqual([PUBLIC])
  })

  it('members sees public and members', () => {
    expect(sees({ as: 'members' })).toEqual([PUBLIC, MEMBERS])
  })

  it('a hat sees its own level and members/public; a hat level is seen by its wearers and the wearers of the hats above it', () => {
    expect(FIXTURE_SOURCE.hatsAbove('ops')).toEqual(['council', 'top'])
    expect(canSee(wearer('council'), hat('ops'), FIXTURE_SOURCE)).toBe(true)
    expect(canSee(wearer('ops'), hat('council'), FIXTURE_SOURCE)).toBe(false)
    expect(sees(wearer('ops'))).toEqual([PUBLIC, MEMBERS, hat('ops')])
    expect(sees(wearer('council'))).toEqual([PUBLIC, MEMBERS, hat('council'), hat('ops')])
    expect(sees(wearer('top'))).toEqual(ALL)
    expect(canSee(wearer('council'), hat('treasury'), FIXTURE_SOURCE)).toBe(false) // a sibling branch, not below it
  })

  it('an item with no facts.visibility is members', () => {
    expect(FIXTURE_SOURCE.visibilityOf({ facts: {} })).toEqual(MEMBERS)
    expect(FIXTURE_SOURCE.visibilityOf({})).toEqual(MEMBERS)
    expect(FIXTURE_SOURCE.visibilityOf(null)).toEqual(MEMBERS)
    expect(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: 'nobody' } })).toEqual(MEMBERS) // a word it does not know
  })

  it('reads facts.visibility: public, members, or hat:<id> named from the tree', () => {
    expect(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: 'public' } })).toEqual(PUBLIC)
    expect(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: 'members' } })).toEqual(MEMBERS)
    expect(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: 'hat:ops' } })).toEqual({ level: 'hat', hat: 'ops', name: 'Ops' })
    expect(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: 'hat:13.9' } })).toEqual({ level: 'hat', hat: '13.9', name: '13.9' })
  })

  it('lists the tree’s hats in order, and the hats the fixture member wears', () => {
    expect(FIXTURE_SOURCE.hats()).toEqual([{ hat: 'top', name: 'Top' }, { hat: 'council', name: 'Council' }, { hat: 'ops', name: 'Ops' }, { hat: 'treasury', name: 'Treasurer' }])
    expect(FIXTURE_SOURCE.worn()).toEqual(['council', 'ops'])
  })
})

describe('readersWithin: a choice that lets nobody new read (applies now) or someone new (a decision)', () => {
  const w = (a: Visibility, b: Visibility) => readersWithin(a, b, FIXTURE_SOURCE)
  it('narrowing: members within public, a hat within members, a hat above within the hat below', () => {
    expect(w(MEMBERS, PUBLIC)).toBe(true)
    expect(w(hat('ops'), MEMBERS)).toBe(true)
    expect(w(hat('council'), hat('ops'))).toBe(true) // ops is read by ops, council and top; council by council and top
    expect(w(hat('ops'), hat('ops'))).toBe(true)
  })
  it('widening: public beyond members, members beyond a hat, a hat below beyond the hat above, a sibling beyond', () => {
    expect(w(PUBLIC, MEMBERS)).toBe(false)
    expect(w(MEMBERS, hat('ops'))).toBe(false)
    expect(w(hat('ops'), hat('council'))).toBe(false)
    expect(w(hat('treasury'), hat('ops'))).toBe(false)
  })
})
