/** The publication as the house's operation catalogue sees it, and the review queue as the resource store sees it:
 *  the app plans and names the command; the CLI writes; what waits on a person reaches Needs you. */
import { afterEach, describe, expect, it } from 'vitest'
import { opById } from '../../../server/operations/catalogue.ts'
import { knowledge } from '../../../server/resources/adapters/knowledge.ts'
import { makeKmsInstance, FIXTURE_NOW, type FixtureInstance } from './fixture.ts'

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const ctx = (repo: string) => ({ repo, now: () => new Date(FIXTURE_NOW), run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }), lastOk: () => null })

describe('knowledge.publish — the one run this lane offers', () => {
  it('plans kms’s own command, with --apply, and declares the plane it writes', async () => {
    instance = makeKmsInstance()
    const op = opById('knowledge.publish')!
    expect(op.effect).toBe('changes')
    expect(op.network).toBe(true) // it reaches the network when a PDS is configured, so it always asks first
    const planned = await op.plan({ id: 'knowledge:commons', kind: 'knowledge' } as never, {}, instance.dir)
    expect(planned).toMatchObject({ cmd: process.execPath })
    const args = (planned as { args: string[] }).args
    expect(args.slice(1)).toEqual(['publish', '--apply', '--dir', instance.dir])
    expect(args[0]!.endsWith('packages/org-os-kms/src/cli.mjs')).toBe(true)
    expect((planned as { writes: string[] }).writes).toEqual(['public/', 'data/kms-published.json'])
  })

  it('runs the kms this server shipped beside when the repository carries none, as the commons is read (walk I11)', () => {
    const op = opById('knowledge.publish')!
    expect(op.unavailable({ id: 'knowledge:commons', kind: 'knowledge' } as never, '/tmp')).toBeNull()
  })
})

describe('the knowledge adapter — what waits on a person reaches Needs you', () => {
  it('answers one row for the commons itself, and no attention on it', async () => {
    instance = makeKmsInstance()
    const result = await knowledge.read(ctx(instance.dir) as never)
    expect('nodes' in result).toBe(true)
    const commons = (result as { nodes: { id: string; attention: unknown; status: string }[] }).nodes.find(n => n.id === 'knowledge:commons')!
    expect(commons.attention).toBeNull()
    expect(commons.status).toBe('6 published')
  })

  it('carries the review queue, and a failed peer read, as clay rows', async () => {
    instance = makeKmsInstance()
    const result = await knowledge.read(ctx(instance.dir) as never)
    const nodes = (result as { nodes: { id: string; attention: { level: string; text: string } | null; name: string }[] }).nodes
    const awaiting = nodes.find(n => n.id === 'knowledge:claim-evidence/seed-swap-notes')!
    expect(awaiting.name).toBe('Seed swap notes')
    expect(awaiting.attention).toEqual({ level: 'warn', text: 'raw · written with AI help' })
    const peer = nodes.find(n => n.id === 'knowledge:peer:connector:atproto')!
    expect(peer.attention).toEqual({ level: 'alert', text: 'last good read 9 d ago' })
  })

  it('is a quiet absence, not a row, when the instance has no canon', async () => {
    instance = makeKmsInstance()
    const { rmSync } = await import('node:fs')
    rmSync(`${instance.dir}/kms.yaml`)
    const result = await knowledge.read(ctx(instance.dir) as never)
    expect('absent' in result).toBe(true)
  })
})
