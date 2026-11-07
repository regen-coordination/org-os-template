import { describe, it, expect, afterEach } from 'vitest'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { createEntry, resolveTrunk } from '../../server/proposals/ledger.ts'
import { Refusal } from '../../server/changes/apply.ts'

// Review §6: the ledger takes the branch the server started on as an option; without it the trunk is whatever
// the repository is on now, so "off the trunk" could never fire. The server captures the branch once and offers it.
// The repository is a throwaway under the temp directory (makeSyntheticRepo); the server listens on a free port.
let repo: string
let server: Running | undefined
afterEach(async () => { await server?.close(); server = undefined; if (repo) removeFixtureRepo(repo) })

const OPTS = { now: () => new Date('2026-10-18T12:00:00Z') }

describe('the branch the server started on', () => {
  it('is captured once, when the server starts, and does not follow the checkout', async () => {
    repo = makeSyntheticRepo()
    server = await startServer({ repo, port: 0 })
    expect(server.startBranch).toBe('main')
    git(repo, 'checkout -q -b feature/x')
    expect(server.startBranch).toBe('main')
  })

  it('makes the ledger refuse a write once the repository is elsewhere (OFF_TRUNK), which it could not without it', async () => {
    repo = makeSyntheticRepo()
    server = await startServer({ repo, port: 0 })
    git(repo, 'checkout -q -b feature/x')
    const entry = { id: 'p-2026-10-18-001', title: 'T', author: 'bruno' }
    const who = { actor: 'bruno', rule: 'solo/direct' }
    // without the option the trunk is the branch the repository is on now, so the guard cannot fire
    expect(await resolveTrunk(repo)).toBe('feature/x')
    const err = await createEntry(repo, entry, who, { ...OPTS, startBranch: server.startBranch }).then(() => null, e => e)
    expect(err).toBeInstanceOf(Refusal)
    expect((err as Refusal).body).toMatchObject({ code: 'OFF_TRUNK' })
    expect(String((err as Refusal).body.error)).toMatch(/on the branch "feature\/x".*the trunk, "main"/)
  })
})
