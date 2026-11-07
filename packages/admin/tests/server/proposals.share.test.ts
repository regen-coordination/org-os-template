import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo, TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { opById, needsConfirm, type Planned } from '../../server/operations/catalogue.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { Plans } from '../../server/operations/plans.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'
import { JobStore } from '../../server/state.ts'
import type { Adapter, Resource } from '../../server/resources/types.ts'

// Share (0.6 P2 spec §3.10, P2-R18, R28, R31): the trunk pushed to origin, never forced, by a refspec the platform builds.
// Every test builds its own world under the OS temp directory: a bare remote and two clones of it. The remote is a
// directory; nothing here reaches a real instance or a real network.
const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
}
const sh = (cwd: string, cmd: string): string => execSync(cmd, { cwd, env: ENV, stdio: 'pipe' }).toString()
const sha = (cwd: string, rev = 'HEAD') => sh(cwd, `git rev-parse ${rev}`).trim()
const commitFile = (repo: string, file: string, text: string) => { writeFileSync(join(repo, file), text); sh(repo, `git add -A && git commit -qm "${file}"`) }

const SELF: Resource = { id: 'instance:self', kind: 'instance', board: 'systems', name: 'this instance', status: null, attention: null, changed: null, facts: { self: true }, source: null }
const PEER: Resource = { ...SELF, id: 'instance:peer', name: 'a peer', facts: { self: false } }
const PLAN_TEXT = 'push -- origin refs/heads/main:refs/heads/main'
const governanceWith = (trunk: string) => `schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  trunk: ${JSON.stringify(trunk)}\n  decisions: []\n`

let root: string
const seeds: string[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'share-'))
  // The tests' own git commands, and the executor's pushes, read no user or system configuration.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null'); vi.stubEnv('GIT_CONFIG_SYSTEM', '/dev/null'); vi.stubEnv('GIT_TERMINAL_PROMPT', '0')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
  for (const s of seeds.splice(0)) removeFixtureRepo(s)
})

let worlds = 0
function clone(remote: string, name: string, who: string): string {
  const dir = join(root, `${name}${worlds}`)
  sh(root, `git clone -q ${remote} ${dir}`)
  // the clone acts as the fixture's member (steward-a's address): planning and running an operation is a member's act
  // (the operations routes check the actor); commits carry the GIT_AUTHOR_* above, so who is named here changes nothing else
  sh(dir, `git config user.name ${who} && git config user.email ${TEST_EMAIL}`)
  return dir
}
/** A bare remote holding the trunk, and two clones of it: `a` (ana) and `b` (bruno). */
function world(governance: string | null = null): { remote: string; a: string; b: string } {
  const seed = makeChangeRepo(governance ?? undefined); seeds.push(seed)
  worlds += 1
  const remote = join(root, `remote${worlds}.git`)
  sh(root, `git init -q --bare -b main ${remote}`)
  sh(seed, `git remote add origin ${remote} && git push -q origin main`)
  return { remote, a: clone(remote, 'a', 'ana'), b: clone(remote, 'b', 'bruno') }
}

function serve(repo: string, startBranch = 'main') {
  const jobs = new JobStore(repo)
  const fleet: Adapter = { name: 'fleet', board: 'systems', title: 'Fleet', watch: [], async read() { return { nodes: [SELF, PEER], edges: [] } } }
  const store = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null }, [fleet])
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: () => {} }, { killGraceMs: 200 })
  const plans = new Plans()
  const app = createApp(repo, a => { mountOperations(a, { repo, store, jobs, executor, plans, startBranch }) })
  return { app, executor, plans }
}
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const planShare = (app: Hono, resource = SELF.id, params?: unknown) => app.request('/api/operations/share/plan', json({ resource, ...(params === undefined ? {} : { params }) }))
/** Confirm and run: the plan, then the job on its nonce, then the finished job. */
async function share(app: Hono) {
  const planned = await planShare(app)
  const plan = await planned.json()
  expect(planned.status, JSON.stringify(plan)).toBe(200)
  const started = await app.request('/api/jobs', json({ nonce: plan.nonce }))
  expect(started.status).toBe(202)
  const { id } = await started.json()
  await expect.poll(async () => (await (await app.request(`/api/jobs/${id}`)).json()).job.status, { interval: 20, timeout: 15_000 })
    .not.toMatch(/^(queued|running)$/)
  return (await (await app.request(`/api/jobs/${id}`)).json()) as { job: { status: string; sentence: string; changed: string[]; surprises: string[] }; log: string }
}

describe('the share operation: its plan', () => {
  it('is a catalogue entry that reaches the network, declares no writes, and asks for a confirmation', () => {
    const op = opById('share')
    expect(op).toBeDefined()
    expect(op).toMatchObject({ network: true, kinds: ['instance'] })
    expect(needsConfirm(op!)).toBe(true)
    expect(op!.params).toEqual({ type: 'object', additionalProperties: false })
    expect(op!.unavailable(SELF, root)).toBeNull()
    expect(op!.unavailable(PEER, root)).toBe("offered on this instance's own card")
  })

  it('prints the push exactly, with a nonce and writes: []; the job is a spawned git push', async () => {
    const { a } = world()
    const { app } = serve(a)
    const res = await planShare(app)
    const plan = await res.json()
    expect(res.status, JSON.stringify(plan)).toBe(200)
    expect(plan).toMatchObject({ op: 'share', resource: SELF.id, inProcess: false, cmd: 'git', args: ['push', '--', 'origin', 'refs/heads/main:refs/heads/main'], writes: [], confirm: true })
    expect(`${plan.args.join(' ')}`).toBe(PLAN_TEXT)
    expect(plan.nonce).toMatch(/^[0-9a-f]{48}$/)
  })

  it('takes no free-text argument: a param of any name is refused, and so is a missing nonce', async () => {
    const { a } = world()
    const { app } = serve(a)
    for (const params of [{ remote: 'upstream' }, { trunk: 'other' }, { refspec: '+main' }, { force: true }]) {
      const res = await planShare(app, SELF.id, params)
      expect(res.status, JSON.stringify(params)).toBe(422)
    }
    const direct = await app.request('/api/jobs', json({ op: 'share', resource: SELF.id }))
    expect(direct.status).toBe(403)
  })

  it('is refused before a nonce exists when the trunk is +main, main:other, or a name git refuses', async () => {
    for (const trunk of ['+main', 'main:other', '-f', 'a..b', 'refs/heads/main', 'proposal/x']) {
      const { a } = world(governanceWith(trunk))
      const { app, plans } = serve(a)
      const issue = vi.spyOn(plans, 'issue')
      const res = await planShare(app)
      const body = await res.json()
      expect(res.status, trunk).toBe(409)
      expect(body.error, trunk).toMatch(/cannot be the trunk/)
      expect(body.nonce, trunk).toBeUndefined()
      expect(issue, trunk).not.toHaveBeenCalled()
    }
  })

  it('names the trunk the repository is on when governance names none, and never contains a force word, a plus, or a second ref', async () => {
    const { a } = world()
    sh(a, 'git checkout -q -b release/1.0')
    const planned = opById('share')!.plan(SELF, {}, a, { startBranch: 'release/1.0' })
    const p = (await planned) as Planned
    expect(p.args).toEqual(['push', '--', 'origin', 'refs/heads/release/1.0:refs/heads/release/1.0'])
    for (const word of ['--force', '-f', '--force-with-lease', '--mirror', '--delete', '--tags', '--all']) expect(p.args).not.toContain(word)
    expect(p.args.filter(t => t.startsWith('+') || t.includes('+'))).toEqual([])
    expect(p.args.filter(t => t.includes(':'))).toEqual(['refs/heads/release/1.0:refs/heads/release/1.0'])
  })
})

describe('the share operation: the push', () => {
  it('pushes the trunk to a bare remote through the executor; HEAD does not move and no file changes', async () => {
    const { remote, a } = world()
    commitFile(a, 'new.txt', 'n\n')
    const head = sha(a)
    expect(sha(remote, 'refs/heads/main')).not.toBe(head)
    const { app } = serve(a)
    const { job } = await share(app)
    expect(job, JSON.stringify(job)).toMatchObject({ status: 'ok', changed: [], surprises: [], sentence: 'Done. No file changed.' })
    expect(sha(remote, 'refs/heads/main')).toBe(head)
    expect(sha(a)).toBe(head)
  })

  it('a remote that has diverged: git refuses the non-fast-forward push, the remote is unchanged, and the platform does not retry', async () => {
    const { remote, a, b } = world()
    commitFile(b, 'theirs.txt', 't\n'); sh(b, 'git push -q origin main')
    const theirs = sha(remote, 'refs/heads/main')
    commitFile(a, 'ours.txt', 'o\n')
    const { app, executor } = serve(a)
    const submit = vi.spyOn(executor, 'submit')
    const { job, log } = await share(app)
    expect(job.status).toBe('failed')
    expect(`${job.sentence}\n${log}`).toMatch(/rejected|non-fast-forward|fetch first/)
    expect(sha(remote, 'refs/heads/main')).toBe(theirs)
    expect(submit).toHaveBeenCalledTimes(1)
    await new Promise(r => setTimeout(r, 300))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(sha(remote, 'refs/heads/main')).toBe(theirs)
  })

  it('a configured remote.origin.push of +refs/heads/*:refs/heads/* is not used: the explicit refspec overrides it', async () => {
    const { remote, a, b } = world()
    sh(a, 'git config remote.origin.push "+refs/heads/*:refs/heads/*"')
    commitFile(b, 'theirs.txt', 't\n'); sh(b, 'git push -q origin main')
    const theirs = sha(remote, 'refs/heads/main')
    commitFile(a, 'ours.txt', 'o\n')
    const { job } = await share(serve(a).app)
    expect(job.status).toBe('failed')
    expect(sha(remote, 'refs/heads/main')).toBe(theirs)
  })

  it('negative control: the naive `push origin +main`, and the configured force refspec, do overwrite a teammate (the test can fail)', () => {
    // Throwaway remotes the test itself made under the OS temp directory.
    const naive = world()
    commitFile(naive.b, 'theirs.txt', 't\n'); sh(naive.b, 'git push -q origin main')
    const theirs = sha(naive.remote, 'refs/heads/main')
    commitFile(naive.a, 'ours.txt', 'o\n')
    sh(naive.a, 'git push -q origin +main')
    expect(sha(naive.remote, 'refs/heads/main')).toBe(sha(naive.a))
    expect(sha(naive.remote, 'refs/heads/main')).not.toBe(theirs)

    const root2 = mkdtempSync(join(tmpdir(), 'share-neg-'))
    try {
      const remote = join(root2, 'remote.git')
      sh(root2, `git init -q --bare -b main ${remote}`)
      const x = join(root2, 'x'); const y = join(root2, 'y')
      sh(root2, `git clone -q ${remote} ${x} && git clone -q ${remote} ${y}`)
      for (const d of [x, y]) sh(d, 'git config user.name t && git config user.email t@example.test && git checkout -q -b main')
      commitFile(x, 'base.txt', 'b\n'); sh(x, 'git push -q origin main')
      sh(y, 'git pull -q origin main')
      sh(x, 'git config remote.origin.push "+refs/heads/*:refs/heads/*"')
      commitFile(y, 'theirs.txt', 't\n'); sh(y, 'git push -q origin main')
      const teammate = sha(remote, 'refs/heads/main')
      commitFile(x, 'ours.txt', 'o\n')
      sh(x, 'git push -q origin') // the configured refspec forces it
      expect(sha(remote, 'refs/heads/main')).toBe(sha(x))
      expect(sha(remote, 'refs/heads/main')).not.toBe(teammate)
    } finally { rmSync(root2, { recursive: true, force: true }) }
  })
})
