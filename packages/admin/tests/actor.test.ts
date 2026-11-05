import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { resolveActor, isKnown, actorTrailer } from '../server/actor.ts'

// The fixture repository commits as admin-test@local, which member steward-a's handles.git holds.
let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const members = (entries: string) => writeFileSync(join(repo, 'data', 'members.yaml'), `schema_version: "2.0"\nmembers:\n${entries}`)

describe('resolveActor', () => {
  it('is unknown, with the address, when no member commits with it', async () => {
    members('  - id: "steward-a"\n    name: "Steward A"\n')
    expect(await resolveActor(repo)).toEqual({ unknown: 'admin-test@local' })
  })
  it('finds the member by one of several git emails, ignoring case', async () => {
    members('  - id: "github:ana-example"\n    name: "Ana Example"\n    handles:\n      git: ["ana@example.org", "Admin-Test@Local"]\n')
    const actor = await resolveActor(repo)
    expect(actor).toEqual({ id: 'github:ana-example', name: 'Ana Example', kind: 'person' })
    expect(isKnown(actor)).toBe(true)
  })
  it('finds a member by a top-level email, and gives their kind', async () => {
    members('  - id: "crew-engineer"\n    kind: "agent"\n    email: "admin-test@local"\n')
    expect(await resolveActor(repo)).toEqual({ id: 'crew-engineer', name: 'crew-engineer', kind: 'agent' })
  })
  it('is unknown when two members claim the address', async () => {
    members('  - id: "ana"\n    handles:\n      git: "admin-test@local"\n  - id: "bruno"\n    email: "admin-test@local"\n')
    expect(await resolveActor(repo)).toEqual({ unknown: 'admin-test@local' })
  })
  it('never matches on a name or an id', async () => {
    members('  - id: "admin-test"\n    name: "admin-test"\n')
    expect(await resolveActor(repo)).toEqual({ unknown: 'admin-test@local' })
  })
  it('is unknown when the member has no id', async () => {
    members('  - name: "No id"\n    handles:\n      git: "admin-test@local"\n')
    expect(await resolveActor(repo)).toEqual({ unknown: 'admin-test@local' })
  })
  it('is unknown, with no address, when git has none set here', async () => {
    execSync('git config user.email ""', { cwd: repo })
    expect(await resolveActor(repo)).toEqual({ unknown: '' })
  })
  it('is unknown when data/members.yaml is absent', async () => {
    rmSync(join(repo, 'data', 'members.yaml'))
    expect(await resolveActor(repo)).toEqual({ unknown: 'admin-test@local' })
  })
})

describe('actorTrailer', () => {
  it('is the member id for a member', () => {
    expect(actorTrailer({ id: 'github:ana-example', name: 'Ana', kind: 'person' })).toBe('github:ana-example')
  })
  it('is unknown <email> otherwise', () => {
    expect(actorTrailer({ unknown: 'ana@example.org' })).toBe('unknown <ana@example.org>')
    expect(actorTrailer({ unknown: '' })).toBe('unknown <>')
  })
})
