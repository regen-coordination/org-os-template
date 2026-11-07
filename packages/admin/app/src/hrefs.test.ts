import { describe, it, expect } from 'vitest'
import { changeKeyHref, changeKeyOf, entryHref, newRecordHref, opHref, recordHref, safeDecode, selectHref, splitChangeKey } from './hrefs.ts'
import { resource } from './test/data.ts'

describe('hrefs', () => {
  it('encodes ids, keeping colons inside an id', () => {
    expect(recordHref('person:a b/c')).toBe('/r/person/a%20b%2Fc')
    expect(recordHref('person:github:steward-a')).toBe('/r/person/github%3Asteward-a')
  })

  it('sends an Add to its registry’s New, asking for the stepped form (Option B) where the caller does', () => {
    expect(newRecordHref('funding-opportunities')).toBe('/new/funding-opportunities')
    expect(newRecordHref('projects', { steps: true })).toBe('/new/projects?steps=1')
    expect(newRecordHref('a b', { steps: false })).toBe('/new/a%20b')
  })

  it("sends a registry entry to its kind's page, or to the registry's own", () => {
    expect(entryHref('funding-opportunities', 'x')).toBe('/r/funding/x')
    expect(entryHref('meetings', '2026-10-16')).toBe('/r/meetings/2026-10-16')
  })

  it('reads change keys by registry name, splitting at the first colon', () => {
    expect(splitChangeKey('members:github:steward-a')).toEqual({ registry: 'members', id: 'github:steward-a' })
    expect(changeKeyHref('projects:river-commons')).toBe('/r/project/river-commons')
    expect(changeKeyOf(resource({ source: { path: 'data/funding-opportunities.yaml', editable: true, registry: 'funding-opportunities', entityId: 'x' } })))
      .toBe('funding-opportunities:x')
    expect(changeKeyOf(resource({ source: { path: 'modules/a/module.yaml', editable: false } }))).toBeNull()
  })

  it('selectHref writes one select per id, encoded, on the map', () => {
    expect(selectHref('organization', ['person:a,b', 'project:x'])).toBe('/b/organization?select=person%3Aa%2Cb&select=project%3Ax')
    expect(selectHref('systems', [])).toBe('/b/systems')
  })

  it('opHref asks the record page to open one operation', () => {
    expect(opHref('module:a', { id: 'module.doctor', label: 'Run doctor' })).toBe('/r/module/a?op=module.doctor&opLabel=Run+doctor')
  })

  it('safeDecode leaves a malformed escape as it was', () => {
    expect(safeDecode('a%20b')).toBe('a b')
    expect(safeDecode('100%')).toBe('100%')
  })

  it('a path recordHref builds decodes back to the same id (Review Focus 4)', () => {
    for (const id of ['a b/c', 'github:steward-a', '100%', 'ação', 'x?y#z']) {
      const [, , kind, enc] = recordHref(`person:${id}`).split('/')
      expect(`${safeDecode(kind!)}:${safeDecode(enc!)}`).toBe(`person:${id}`)
    }
  })
})
