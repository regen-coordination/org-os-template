import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CHANGE_CLASSES, classOf, governedClassOf } from '../../lib/change-classes.mjs'

const TABLE = JSON.parse(readFileSync(new URL('../../../../schemas/change-classes.json', import.meta.url), 'utf8'))

describe('schemas/change-classes.json', () => {
  it('is F1 spec §3.7, row for row, with L5 §9.7\'s publication class', () => {
    expect(TABLE).toEqual({
      classes: ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations', 'publication'],
      map: [
        { registry: 'members', class: 'members' },
        { registry: 'governance', class: 'governance' },
        { registry: 'systems', class: 'systems' },
        { path: 'IDENTITY.md', class: 'identity' },
        { path: 'federation.yaml', class: 'identity' },
        { path: '.well-known/**', class: 'identity' },
        { registry: 'visibility', class: 'publication' },
        { registry: '*', class: 'records' },
      ],
    })
  })
  it('CHANGE_CLASSES is its class list', () => expect(CHANGE_CLASSES).toEqual(TABLE.classes))
})

describe('the publication class (L5 §9.7)', () => {
  it('publication is a class', () => expect(CHANGE_CLASSES).toContain('publication'))
  it('data/visibility.yaml is class publication', () => {
    expect(classOf({ path: 'data/visibility.yaml' })).toBe('publication')
    expect(classOf({ registry: 'visibility' })).toBe('publication')
    expect(governedClassOf('data/visibility.yaml')).toBe('publication')
  })
})

describe('classOf', () => {
  it('classes a board as records (P4 §5.1)', () => expect(classOf({ registry: 'boards' })).toBe('records'))
  it.each([
    ['members', 'members'], ['governance', 'governance'], ['systems', 'systems'],
    ['projects', 'records'], ['funding-opportunities', 'records'], ['knowledge-gaps', 'records'], ['meetings', 'records'],
  ])('registry %s is %s', (registry, cls) => expect(classOf({ registry })).toBe(cls))

  it.each([
    ['IDENTITY.md', 'identity'], ['federation.yaml', 'identity'],
    ['.well-known/dao.json', 'identity'], ['.well-known/schemas/members.json', 'identity'],
    ['data/members.yaml', 'members'], ['data/governance.yaml', 'governance'], ['data/systems.yaml', 'systems'],
    ['data/projects.yaml', 'records'], ['MASTERPLAN.md', 'records'],
  ])('path %s is %s', (path, cls) => expect(classOf({ path })).toBe(cls))

  it('first match wins: members is members, though the * row would match it too', () => {
    expect(classOf({ registry: 'members' })).toBe('members')
  })
  it('reads a path however it is spelled', () => {
    expect(classOf({ path: './IDENTITY.md' })).toBe('identity')
    expect(classOf({ path: 'data/../federation.yaml' })).toBe('identity')
    expect(classOf({ path: 'data\\members.yaml' })).toBe('members')
  })
  it('a file that only looks like a protected one is not it', () => {
    expect(classOf({ path: 'docs/IDENTITY.md' })).toBe('records')
    expect(classOf({ path: '.well-known-notes.md' })).toBe('records')
  })
})

describe('governedClassOf (F2 spec §3.8): the files a rule can govern', () => {
  it.each([
    ['data/projects.yaml', 'records'], ['data/members.yaml', 'members'], ['data/governance.yaml', 'governance'],
    ['data/systems.yaml', 'systems'], ['data/boards.yaml', 'records'], ['IDENTITY.md', 'identity'],
    ['federation.yaml', 'identity'], ['.well-known/dao.json', 'identity'], ['./data/ideas.yaml', 'records'],
    ['data/crm.yaml', 'records'], ['data/some-new-registry.yml', 'records'],
  ])('%s is governed as %s', (path, cls) => expect(governedClassOf(path)).toBe(cls))

  it.each(['README.md', 'scripts/doctor.mjs', 'docs/IDENTITY.md', 'memory/2026-10-18.md',
    'data/proposals.yaml', 'data/nested/projects.yaml', 'data/projects.yaml.bak', 'site/src/index.astro'])('%s is not governed', path => {
    expect(governedClassOf(path)).toBeNull()
  })
})

describe('governedClassOf agrees with classOf on every data file (M4)', () => {
  it.each(['data/projects.yaml', 'data/members.yaml', 'data/governance.yaml', 'data/systems.yaml', 'data/crm.yaml', 'data/ideas.yaml', 'data/anything-new.yaml'])(
    '%s', path => expect(governedClassOf(path)).toBe(classOf({ path })))
  it('except data/proposals.yaml, which F2-R13 leaves to P2', () => {
    expect(classOf({ path: 'data/proposals.yaml' })).toBe('records')
    expect(governedClassOf('data/proposals.yaml')).toBeNull()
  })
})

describe('splits are accepted and inert (M1, F2-R3)', () => {
  it('classOf never answers a split: no path or registry yields records:funding', () => {
    for (const target of [{ path: 'data/funding.yaml' }, { path: 'data/projects.yaml' }, { registry: 'funding' }, { registry: 'projects' }]) {
      expect(CHANGE_CLASSES).toContain(classOf(target))
      expect(classOf(target)).not.toContain(':')
    }
  })
})
