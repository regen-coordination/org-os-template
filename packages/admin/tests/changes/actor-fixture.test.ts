import { describe, it, expect, afterEach } from 'vitest'
import { makeFixtureRepo, makeRealDataRepo, removeFixtureRepo } from '../fixtures.ts'
import { resolveActor } from '../../server/actor.ts'

describe('every temp repository has an actor', () => {
  let repo: string
  afterEach(() => removeFixtureRepo(repo))
  it('the fixture repository commits as member steward-a', async () => {
    repo = makeFixtureRepo()
    expect(await resolveActor(repo)).toMatchObject({ id: 'steward-a', kind: 'person' })
  })
  it('the copy of the real registries commits as the appended test member', async () => {
    repo = makeRealDataRepo()
    expect(await resolveActor(repo)).toMatchObject({ id: 'admin-test', kind: 'person' })
  })
})
