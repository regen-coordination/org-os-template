import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import { stateDir } from '../../server/state.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const ctx = (): AdapterContext => ({ repo, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })
const save = (doc: unknown) => { mkdirSync(stateDir(repo), { recursive: true }); writeFileSync(join(stateDir(repo), 'doctor.json'), JSON.stringify(doc)) }
const f = (level: string, message: string) => ({ level, code: 'x', message })

describe("the self card carries the doctor's findings", () => {
  it('is unchanged with no doctor.json', async () => {
    expect(((await fleet.read(ctx())) as Graph).nodes[0]!.attention).toBeNull()
  })
  it('alerts on blockers', async () => {
    save({ at: 'now', status: 'blocked', blockers: 2, warnings: 0, findings: [f('BLOCKER', 'no identity'), f('BLOCKER', 'two')] })
    expect(((await fleet.read(ctx())) as Graph).nodes[0]!.attention).toEqual({ level: 'alert', text: 'The doctor found 2 blocker(s) when this instance was opened: no identity' })
  })
  it('warns on warnings alone', async () => {
    save({ at: 'now', status: 'ok', blockers: 0, warnings: 1, findings: [f('WARN', 'thin')] })
    expect(((await fleet.read(ctx())) as Graph).nodes[0]!.attention).toEqual({ level: 'warn', text: 'The doctor found 1 warning(s) when this instance was opened: thin' })
  })
  it('stays unchanged when the file is clean or unreadable', async () => {
    save({ blockers: 0, warnings: 0, findings: [] })
    expect(((await fleet.read(ctx())) as Graph).nodes[0]!.attention).toBeNull()
    writeFileSync(join(stateDir(repo), 'doctor.json'), '{not json')
    expect(((await fleet.read(ctx())) as Graph).nodes[0]!.attention).toBeNull()
  })
})
