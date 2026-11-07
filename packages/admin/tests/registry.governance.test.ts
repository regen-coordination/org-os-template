import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { readRegistry } from '../server/registry.ts'
import { createApp } from '../server/app.ts'
import { HttpError } from '../server/errors.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const governance = (text: string) => writeFileSync(join(repo, 'data', 'governance.yaml'), text)
const MULTI = 'schema_version: "2.0"\n---\ndecisions:\n  - id: "d1"\n---\nnotes:\n  topic: "kept beside the record"\n'

describe('readRegistry(governance) reads it as instances write it', () => {
  it('the governance: wrapper', () => {
    governance('schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n')
    expect(readRegistry(repo, 'governance')).toEqual({
      name: 'governance', kind: 'document', schemaVersion: '2.0', document: { model: 'solo-maintainer', decisions: [] },
    })
  })
  it('a flat file, as if it were wrapped', () => {
    governance('schema_version: "2.0"\ndecisions:\n  - id: "d1"\n    title: "T"\n    date: "2026-08-04"\n    status: "adopted"\n')
    expect(readRegistry(repo, 'governance').document).toEqual({
      decisions: [{ id: 'd1', title: 'T', date: '2026-08-04', status: 'adopted' }], model: 'solo-maintainer',
    })
  })
  it('decision_model, as model', () => {
    governance('governance:\n  decision_model: "consensus"\n  roles: []\n')
    expect(readRegistry(repo, 'governance').document).toEqual({ model: 'consensus', roles: [] })
  })
  it('a file with no governance in it, as solo-maintainer', () => {
    governance('schema_version: "2.0"\n')
    expect(readRegistry(repo, 'governance').document).toEqual({ model: 'solo-maintainer' })
  })
})

describe('a governance.yaml of several YAML documents', () => {
  it('is refused with 409, saying what to do, and nothing is merged', () => {
    governance(MULTI)
    let caught: unknown
    try { readRegistry(repo, 'governance') } catch (err) { caught = err }
    expect(caught).toBeInstanceOf(HttpError)
    expect((caught as HttpError).status).toBe(409)
    expect((caught as HttpError).code).toBe('MULTIPLE_DOCS')
    expect((caught as HttpError).message).toMatch(/^data\/governance\.yaml holds 3 YAML documents/)
    expect((caught as HttpError).message).toMatch(/Merge them into one document under `governance:` by hand/)
  })
  it('answers 409 over HTTP', async () => {
    governance(MULTI)
    const res = await createApp(repo).request('/api/registries/governance')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/holds 3 YAML documents/)
    expect(body.code).toBe('MULTIPLE_DOCS')
  })
})
