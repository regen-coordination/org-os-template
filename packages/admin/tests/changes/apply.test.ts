import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo, PROJECTS_YAML, MEMBERS_YAML, IDEAS_YAML } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { withFailingCommit } from '../git-shim.ts'
import { applyOps, Refusal, StageRefusal, Referred } from '../../server/changes/apply.ts'
import { HttpError } from '../../server/errors.ts'
import { actorTrailer, resolveActor } from '../../server/actor.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import type { RecordError, StageOp } from '../../server/changes/types.ts'

/** The whole-change backstop (step 5) cannot be reached by ops that pass step 3, so one test makes
 *  validateChange answer errors when it is judged against the texts about to be written. Every
 *  other call goes to the real one. */
const backstop = vi.hoisted(() => ({ errors: null as RecordError[] | null }))
vi.mock('../../server/changes/stage.ts', async importOriginal => {
  const real = await importOriginal<typeof import('../../server/changes/stage.ts')>()
  return { ...real, validateChange: (...args: Parameters<typeof real.validateChange>) => backstop.errors ?? real.validateChange(...args) }
})

let repo: string
beforeEach(() => { repo = makeChangeRepo() })
afterEach(() => removeFixtureRepo(repo))
const path = (name: string) => join(repo, 'data', `${name}.yaml`)
const read = (name: string) => readFileSync(path(name), 'utf8')
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const TRAILERS = { actor: 'steward-a', change: 'chg_test', rule: 'solo/direct' }
const OPS: StageOp[] = [
  { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } },
  { op: 'update', record: 'members:ana', set: { role: 'Steward' } },
]
const opts = (more = {}) => ({ message: 'admin(projects, members): apply 2 changes', trailers: TRAILERS, ...more })

describe('applyOps', () => {
  it('applies ops across two files as one commit carrying all three trailers', async () => {
    // The actor's trailer value is F1's actorTrailer, never rebuilt (S7).
    const trailers = { ...TRAILERS, actor: actorTrailer(await resolveActor(repo)) }
    const { commit } = await applyOps(repo, OPS, opts({ trailers }))
    expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
    expect(commits()).toBe(3)
    expect(git(repo, 'show --name-only --pretty=format: HEAD').trim().split('\n').sort()).toEqual(['data/members.yaml', 'data/projects.yaml'])
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual(TRAILERS)
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('admin(projects, members): apply 2 changes')
    // Through the reviewed splice: comments and quote style survive, only the edited line changes.
    expect(read('projects')).toBe(PROJECTS_YAML.replace('status: "execute"', 'status: "develop"'))
    expect(read('members')).toContain('name: "Ana Silva" # prefers async comms')
    expect(read('members')).toContain('role: "Steward"')
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a write that fails part-way puts every file back byte for byte, and commits nothing', async () => {
    const before = { projects: readFileSync(path('projects')), members: readFileSync(path('members')) }
    let n = 0
    const write = (p: string, text: string) => { if (++n === 2) throw new Error('disk full'); writeFileSync(p, text) }
    await expect(applyOps(repo, OPS, opts({ write }))).rejects.toMatchObject({
      status: 503, message: expect.stringMatching(/^Not saved: data\/projects\.yaml and data\/members\.yaml could not be written \(disk full\)\. Nothing was changed in the files\./),
    })
    expect(readFileSync(path('projects')).equals(before.projects)).toBe(true)
    expect(readFileSync(path('members')).equals(before.members)).toBe(true)
    expect(commits()).toBe(2)
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a commit the hook refuses puts both files back, in the tree and in the index', async () => {
    const before = { projects: read('projects'), members: read('members') }
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    await expect(applyOps(repo, OPS, opts())).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/not saved.*hook says no.*try again/is) })
    expect(read('projects')).toBe(before.projects)
    expect(read('members')).toBe(before.members)
    expect(commits()).toBe(2)
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a commit that landed stays landed when reading its sha fails afterwards', async () => {
    // A post-commit hook points HEAD at a ref that does not exist, so `rev-parse HEAD` fails after the commit is made.
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\ngit symbolic-ref HEAD refs/heads/nowhere\n', { mode: 0o755 })
    const { commit } = await applyOps(repo, OPS, opts())
    git(repo, 'symbolic-ref HEAD refs/heads/main')
    expect(commit).toBe(git(repo, 'rev-parse main').trim())
    expect(commits()).toBe(3)
    expect(read('projects')).toBe(PROJECTS_YAML.replace('status: "execute"', 'status: "develop"'))
    expect(read('members')).toContain('role: "Steward"')
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a commit git reports failed after it landed is never put back: the committed bytes stay and its sha is answered (F-1)', async () => {
    const { commit } = await withFailingCommit('after-landing', () => applyOps(repo, OPS, opts()))
    expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
    expect(commits()).toBe(3)
    expect(parseTrailers(git(repo, 'log -1 --format=%B')).change).toBe('chg_test')
    expect(read('projects')).toBe(PROJECTS_YAML.replace('status: "execute"', 'status: "develop"'))
    expect(read('members')).toContain('role: "Steward"')
    expect(git(repo, 'show HEAD:data/projects.yaml')).toBe(read('projects'))
  })

  it('a create on a registry with no file yet makes the file under its canonical top key', async () => {
    await applyOps(repo, [{ op: 'create', record: 'funding-opportunities:f1', value: { id: 'f1', title: 'Fund' } }],
      opts({ message: 'admin(funding-opportunities): create f1' }))
    expect(read('funding-opportunities')).toBe('funding_opportunities:\n  - id: f1\n    title: Fund\n')
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a create on a new file that the hook refuses leaves no file and no index entry', async () => {
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await expect(applyOps(repo, [{ op: 'create', record: 'events:launch', value: { id: 'launch' } }], opts())).rejects.toMatchObject({ status: 503 })
    expect(existsSync(path('events'))).toBe(false)
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('refuses a file holding uncommitted edits before anything is judged or written', async () => {
    writeFileSync(path('members'), `${read('members')}  - id: "wip"\n`)
    const held = read('members')
    const err = await applyOps(repo, OPS, opts()).catch(e => e)
    expect(err).toMatchObject({
      status: 409,
      body: { code: 'DIRTY', paths: ['data/members.yaml'], error: expect.stringContaining('Not saved: data/members.yaml has changes that are not committed yet') },
    })
    // One error hierarchy (S8): a Refusal is an HttpError whose message and code are its body's.
    expect(err).toBeInstanceOf(Refusal)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.code).toBe('DIRTY')
    expect(err.message).toBe(err.body.error)
    expect(read('members')).toBe(held)
    expect(read('projects')).toBe(PROJECTS_YAML)
  })

  it('refuses a file git was told not to look at, in the reviewed words, naming every offending file', async () => {
    git(repo, 'update-index --assume-unchanged data/projects.yaml')
    writeFileSync(path('members'), `${read('members')}  - id: "wip"\n`)
    const err = await applyOps(repo, OPS, opts()).catch(e => e)
    expect(err).toBeInstanceOf(Refusal)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('DIRTY')
    expect(err.body.paths).toEqual(['data/projects.yaml', 'data/members.yaml'])
    expect(err.body.error).toMatch(/^Not saved: data\/projects\.yaml is marked assume-unchanged in git, .*Nothing was written\. Run `git update-index --no-assume-unchanged data\/projects\.yaml`/)
    expect(read('projects')).toBe(PROJECTS_YAML)
    expect(commits()).toBe(2)
  })

  it('an empty change is refused as 400 EMPTY before anything is read', async () => {
    let checked = false
    const err = await applyOps(repo, [], opts({ precheck: () => { checked = true } })).catch(e => e)
    expect(err).toBeInstanceOf(Refusal)
    expect(err.status).toBe(400)
    expect(err.body).toEqual({ error: 'Nothing is staged: the change holds no ops to apply.', code: 'EMPTY' })
    expect(checked).toBe(false)
    expect(commits()).toBe(2)
  })

  it('runs the precheck after the guards, and stops on its refusal', async () => {
    await expect(applyOps(repo, OPS, opts({ precheck: () => { throw new Refusal(403, { reason: 'no' }) } }))).rejects.toBeInstanceOf(Refusal)
    expect(commits()).toBe(2)
  })

  it('field errors carry their record', async () => {
    const err = await applyOps(repo, [{ op: 'update', record: 'projects:proj-001', set: { lead: 'ghost' } }], opts()).catch(e => e)
    expect(err).toBeInstanceOf(StageRefusal)
    expect(err.status).toBe(422)
    expect(err.errors).toEqual([{ record: 'projects:proj-001', field: 'lead', message: 'no member with id "ghost" in members' }])
  })

  it('an op aimed at an id two entries share is refused before anything is written', async () => {
    writeFileSync(path('projects'), `${PROJECTS_YAML}  - id: "proj-001"\n    title: "Twin"\n`)
    git(repo, 'commit -qam twin')
    const held = read('projects')
    const err = await applyOps(repo, [OPS[0]!], opts()).catch(e => e)
    expect(err).toBeInstanceOf(StageRefusal)
    expect(err.errors).toEqual([{ record: 'projects:proj-001', field: 'id', message: 'id `proj-001` appears 2 times in `data/projects.yaml`; fix it in the file.' }])
    expect(read('projects')).toBe(held)
  })

  it('a record with no registry or no id is refused as a field error, not thrown raw', async () => {
    const err = await applyOps(repo, [{ op: 'delete', record: 'projects:' }], opts()).catch(e => e)
    expect(err).toBeInstanceOf(StageRefusal)
    expect(err.errors).toEqual([{ record: 'projects:', field: 'id', message: '"projects:" has no id after the colon: a record is written <registry>:<id>.' }])
    expect(commits()).toBe(2)
  })

  it('a delete others still name is refused in the reviewed words', async () => {
    const err = await applyOps(repo, [{ op: 'delete', record: 'members:steward-a' }], opts()).catch(e => e)
    expect(err).toBeInstanceOf(Referred)
    expect(err.message).toMatch(/^Not deleted: members "steward-a" is still referred to by projects "proj-001" \(lead\)/)
    expect(read('members')).toBe(MEMBERS_YAML)
  })

  describe('an id is never changed by an update or a replace', () => {
    const ID_FIXED = "an entry's id cannot be changed here; create a new entry and delete this one"
    const ana = { name: 'Ana Silva', role: 'Contributor', layer: 'contributor', status: 'active', joined: '2025-02-01' }
    const refused = async (op: StageOp) => {
      const err = await applyOps(repo, [op], opts()).catch(e => e)
      expect(err).toBeInstanceOf(StageRefusal)
      expect(err.errors).toEqual([{ record: op.record, field: 'id', message: ID_FIXED }])
      expect(read('members')).toBe(MEMBERS_YAML)
      expect(commits()).toBe(2)
      expect(git(repo, 'status --porcelain')).toBe('')
    }
    it('a replace that renames', () => refused({ op: 'replace', record: 'members:ana', value: { id: 'carla', ...ana } }))
    it('an update that renames', () => refused({ op: 'update', record: 'members:ana', set: { id: 'carla' } }))
    it('a rename onto an id the file already holds', () => refused({ op: 'update', record: 'members:ana', set: { id: 'steward-a' } }))
  })

  it('an update of an entry the file does not hold is not found', async () => {
    await expect(applyOps(repo, [{ op: 'update', record: 'projects:ghost', set: { title: 'x' } }], opts())).rejects.toThrow('entity not found: ghost')
    expect(read('projects')).toBe(PROJECTS_YAML)
  })

  it('a numeric id is addressed by its string (S12)', async () => {
    writeFileSync(path('ideas'), `${IDEAS_YAML.replace('ideas: []', 'ideas:')}\n  - id: 7\n    title: "Seven"\n`)
    git(repo, 'commit -qam seven')
    const { commit } = await applyOps(repo, [{ op: 'delete', record: 'ideas:7' }], opts({ message: 'admin(ideas): delete 7' }))
    expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
    expect(read('ideas')).not.toContain('Seven')
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('the whole-change backstop, reached on its own, refuses with 422 and writes nothing', async () => {
    const errors = [{ record: 'projects:proj-001', field: 'lead', message: 'no member with id "ghost" in members' }]
    backstop.errors = errors
    try {
      const err = await applyOps(repo, OPS, opts()).catch(e => e)
      expect(err).toBeInstanceOf(StageRefusal)
      expect(err.status).toBe(422)
      expect(err.errors).toEqual(errors)
      expect(err.message).toBe('Not saved: the change has 1 error. Nothing was written.')
    } finally { backstop.errors = null }
    expect(read('projects')).toBe(PROJECTS_YAML)
    expect(read('members')).toBe(MEMBERS_YAML)
    expect(commits()).toBe(2)
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('ops that change nothing make no commit', async () => {
    const project = { id: 'proj-001', title: 'Node Onboarding Program', status: 'execute', type: 'program', lead: 'steward-a', contributors: ['ana'], tags: ['nodes', 'onboarding'] }
    expect(await applyOps(repo, [{ op: 'replace', record: 'projects:proj-001', value: project }], opts())).toEqual({ commit: null })
    expect(commits()).toBe(2)
  })
})
