import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { stage, staleOps, changeView, validateChange } from '../../server/changes/stage.ts'
import { ChangeStore, newChangeId } from '../../server/changes/store.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { SOLO_RULE } from '../../server/governance/effective.ts'

/** These changes hold no private part: nothing for the tray to read back. */
const NO_PRIVATE = () => null

let repo: string
beforeEach(() => { repo = makeChangeRepo() })
afterEach(() => removeFixtureRepo(repo))
const ACTOR = { id: 'steward-a', name: 'Steward A', kind: 'person' }
const projects = () => join(repo, 'data', 'projects.yaml')

describe('stage', () => {
  it('stages an update against the entry as the file holds it', () => {
    const current = readRegistry(repo, 'projects').entries![0]!
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    expect(errors).toEqual([])
    expect(ops).toEqual([{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' }, base: baseOf(current), before: current }])
  })

  it('answers field errors with the record, and keeps nothing', () => {
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { lead: 'ghost' } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([{ record: 'projects:proj-001', field: 'lead', message: 'no member with id "ghost" in members' }])
  })

  it('a reference to a record created in the same change passes', () => {
    const { errors } = stage(repo, [], [
      { op: 'create', record: 'members:carla', value: { name: 'Carla', layer: 'contributor', status: 'active', joined: '2026-10-01' } },
      { op: 'update', record: 'projects:proj-001', set: { lead: 'carla' } },
    ])
    expect(errors).toEqual([])
  })

  it('a delete that others still name is refused, naming them', () => {
    expect(stage(repo, [], [{ op: 'delete', record: 'members:steward-a' }]).errors)
      .toEqual([{ record: 'members:steward-a', field: '', message: expect.stringMatching(/Not deleted: members "steward-a" is still referred to by projects "proj-001" \(lead\)/) }])
  })

  it('the same delete passes once the change also moves the reference off it', () => {
    expect(stage(repo, [], [
      { op: 'update', record: 'projects:proj-001', set: { lead: 'ana' } },
      { op: 'delete', record: 'members:steward-a' },
    ]).errors).toEqual([])
  })

  it('a record the change created cannot be deleted while the change still points at it', () => {
    const carla = { name: 'Carla', layer: 'contributor', status: 'active', joined: '2026-10-01' }
    const first = stage(repo, [], [
      { op: 'create', record: 'members:carla', value: carla },
      { op: 'update', record: 'projects:proj-001', set: { lead: 'carla' } },
    ])
    expect(first.errors).toEqual([])
    const second = stage(repo, first.ops, [{ op: 'delete', record: 'members:carla' }])
    expect(second.ops).toEqual(first.ops)
    expect(second.errors).toEqual([{ record: 'members:carla', field: '', message: expect.stringMatching(/Not deleted: members "carla" is still referred to by projects "proj-001" \(lead\)/) }])
  })

  it('validateChange reports a dangling reference when the create it needed was removed', () => {
    const { ops } = stage(repo, [], [
      { op: 'create', record: 'members:carla', value: { name: 'Carla', layer: 'contributor', status: 'active', joined: '2026-10-01' } },
      { op: 'update', record: 'projects:proj-001', set: { lead: 'carla' } },
    ])
    expect(validateChange(repo, ops)).toEqual([])
    expect(validateChange(repo, ops.filter(o => o.op !== 'create')))
      .toEqual([{ record: 'projects:proj-001', field: 'lead', message: 'no member with id "carla" in members' }])
  })

  it('an op aimed at an entry with no id is a 422 on the id', () => {
    expect(stage(repo, [], [{ op: 'update', record: 'projects:', set: { status: 'x' } }]).errors)
      .toEqual([{ record: 'projects:', field: 'id', message: '"projects:" has no id after the colon: a record is written <registry>:<id>.' }])
    // The id-less entry as lists show it, by its 1-based position.
    writeFileSync(projects(), `${readFileSync(projects(), 'utf8')}  - title: "No id"\n`)
    git(repo, 'commit -qam noid')
    expect(stage(repo, [], [{ op: 'update', record: 'projects:#2', set: { status: 'x' } }]).errors)
      .toEqual([{ record: 'projects:#2', field: 'id', message: 'entry #2 in `data/projects.yaml` has no id, so it cannot be changed here; give it one in the file.' }])
  })

  it('an op aimed at an id two entries in its file share is a 422 on the id, and nothing is staged', () => {
    writeFileSync(projects(), `${readFileSync(projects(), 'utf8')}  - id: "proj-001"\n    title: "Twin"\n`)
    git(repo, 'commit -qam twin')
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([{ record: 'projects:proj-001', field: 'id', message: 'id `proj-001` appears 2 times in `data/projects.yaml`; fix it in the file.' }])
  })

  it('a "#n" naming an entry that has an id is just an entry that is not there', () => {
    expect(stage(repo, [], [{ op: 'update', record: 'projects:#1', set: { status: 'x' } }]).errors)
      .toEqual([{ record: 'projects:#1', field: '', message: 'projects has no entry "#1".' }])
  })

  it('a numeric id is found, compared as a string (the schema then says ids are strings)', () => {
    writeFileSync(projects(), `${readFileSync(projects(), 'utf8')}  - id: 42\n    title: "Numeric"\n    status: "idea"\n    type: "program"\n    lead: "steward-a"\n`)
    git(repo, 'commit -qam numeric')
    expect(stage(repo, [], [{ op: 'update', record: 'projects:42', set: { status: 'develop' } }]).errors)
      .toEqual([{ record: 'projects:42', field: 'id', message: 'must be string' }])
  })

  it('refuses to stage against a registry file with YAML errors, and says so', () => {
    writeFileSync(projects(), `${readFileSync(projects(), 'utf8')}    title: "twice"\n`)
    git(repo, 'commit -qam broken')
    expect(() => stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }]))
      .toThrow(/^Not saved: data\/projects\.yaml is not valid YAML, so this app will not rewrite it: .*Nothing was written\. Correct the file by hand, then try again\.$/)
  })

  it('an op on an entry that is not there is a record error', () => {
    expect(stage(repo, [], [{ op: 'delete', record: 'projects:ghost' }]).errors)
      .toEqual([{ record: 'projects:ghost', field: '', message: 'projects has no entry "ghost".' }])
  })

  it('an outside edit marks the op stale; the view shows the entry as it is now', () => {
    const { ops } = stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('title: "Node Onboarding Program"', 'title: "Edited elsewhere"'))
    git(repo, 'commit -qam outside')
    expect(staleOps(repo, ops)).toEqual([0])
    const view = changeView(repo, ACTOR, { id: 'chg_x', actor: 'steward-a', created: 't0', updated: 't1', ops }, NO_PRIVATE)
    expect(view).toMatchObject({ id: 'chg_x', actor: 'steward-a', stale: [0], classes: ['records'], rule: SOLO_RULE })
    expect(view.state).toBe('stale')
    expect(view.current[0]).toMatchObject({ title: 'Edited elsewhere' })
  })

  it('an actor git cannot match is shown as git writes it', () => {
    expect(changeView(repo, { unknown: 'x@y.z' }, null, NO_PRIVATE).actor).toBe('unknown <x@y.z>')
  })

  it('the empty view', () => {
    expect(changeView(repo, ACTOR, null, NO_PRIVATE)).toEqual({
      id: '', actor: 'steward-a', created: '', updated: '', ops: [], classes: [], rule: SOLO_RULE, stale: [], current: [], state: 'empty',
    })
  })
})

describe('ChangeStore', () => {
  const change = (ops: unknown[] = [{ op: 'delete', record: 'projects:proj-001', base: 'b', before: {} }]) =>
    ({ id: newChangeId(), actor: 'steward-a', created: 't', updated: 't', ops }) as Parameters<ChangeStore['save']>[0]

  it('keeps one change per actor, outside the repository, written whole', () => {
    const store = new ChangeStore(repo)
    const c = change()
    store.save(c)
    expect(store.file('steward-a').startsWith(repo)).toBe(false)
    expect(store.load('steward-a')).toEqual(c)
    expect(readdirSync(dirname(store.file('steward-a'))).filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(git(repo, 'status --porcelain')).toBe('')
    expect(c.id).toMatch(/^chg_[0-9a-z]+[0-9a-f]{8}$/)
  })

  it('names the file safely for any member id (Review Focus 1)', () => {
    const name = basename(new ChangeStore(repo).file('did:example:steward-a'))
    expect(name).toMatch(/^did_example_steward-a-[0-9a-f]{8}\.json$/)
    expect(basename(new ChangeStore(repo).file('a:b'))).not.toBe(basename(new ChangeStore(repo).file('a_b')))
  })

  it('a change with no ops is not kept', () => {
    const store = new ChangeStore(repo)
    store.save(change())
    store.save(change([]))
    expect(existsSync(store.file('steward-a'))).toBe(false)
    expect(store.load('steward-a')).toBeNull()
  })

  it('an unreadable change file is put aside, never overwritten', () => {
    const store = new ChangeStore(repo)
    mkdirSync(dirname(store.file('steward-a')), { recursive: true })
    writeFileSync(store.file('steward-a'), '{ half a change')
    expect(store.load('steward-a')).toBeNull()
    const aside = readdirSync(dirname(store.file('steward-a'))).filter(f => f.includes('.unreadable-'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(dirname(store.file('steward-a')), aside[0]!), 'utf8')).toBe('{ half a change')
  })
})
