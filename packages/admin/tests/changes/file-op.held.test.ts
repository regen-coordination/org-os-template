// DAO-OS L6 §11.2, §16 (Task 19 review I1, M1, M2): GET /api/files and a file op answer only for what git holds. A path
// git ignores, one under the private store's place, an untracked file, and one reached through a link (a link file, a
// linked folder, anything whose real place is outside the repository) answer as an ungoverned path does: the same 404
// sentence, nothing of the text, and a file op on one is refused at stage and again at apply, nothing written. Every test
// builds a throwaway repository under the temp directory; placeholders only.
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { blobId } from '../../server/workspace/files.ts'

let repo: string
let outside: string
let app: Hono
const privateWas = process.env.ORG_OS_PRIVATE_DIR
afterEach(() => {
  removeFixtureRepo(repo)
  rmSync(outside, { recursive: true, force: true })
  process.env.ORG_OS_PRIVATE_DIR = privateWas
})

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const UNGOVERNED = (path: string) => `${path} is not a governed file, so it has no editor here.`
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
function setup() {
  repo = makeChangeRepo()
  outside = mkdtempSync(join(tmpdir(), 'held-outside-'))
  app = createApp(repo)
}
const commit = (msg: string) => { git(repo, 'add -A'); git(repo, `commit -qm "${msg}"`) }

/** GET /api/files on `path` answers the ungoverned 404, and nothing of `secret`. */
async function readsAsUngoverned(path: string, secret: string) {
  const res = await app.request(`/api/files?path=${encodeURIComponent(path)}`)
  const body = await res.text()
  expect(res.status).toBe(404)
  expect(JSON.parse(body)).toEqual({ error: UNGOVERNED(path) })
  expect(body).not.toContain(secret)
}

/** A Save of `path` is refused at stage (422, the ungoverned sentence), nothing staged. */
async function stageRefused(path: string) {
  const res = await app.request('/api/changes/ops', json({ ops: [{ op: 'file', path, text: 'EDITED\n', base: null }] }))
  expect(res.status).toBe(422)
  const { errors } = await res.json() as { errors: { record: string; message: string }[] }
  expect(errors).toEqual([{ record: path, field: 'path', message: `${UNGOVERNED(path)} Nothing was staged.` }])
  expect(new ChangeStore(repo).load('steward-a')).toBeNull()
}

describe('GET /api/files serves only what git holds (T19 review I1)', () => {
  it('an ignored file (a store-like folder under memory/) answers the ungoverned 404', async () => {
    setup()
    writeFileSync(join(repo, '.gitignore'), 'memory/.private/\n'); commit('ignore')
    mkdirSync(join(repo, 'memory', '.private'), { recursive: true })
    writeFileSync(join(repo, 'memory', '.private', 'house.db'), 'SQLite format 3\u0000 COUNCIL-ONLY-SECRET')
    await readsAsUngoverned('memory/.private/house.db', 'COUNCIL-ONLY-SECRET')
  })

  it('an ignored path that does not exist answers the ungoverned 404 too', async () => {
    setup()
    writeFileSync(join(repo, '.gitignore'), 'memory/local/\n'); commit('ignore')
    await readsAsUngoverned('memory/local/n.md', '"text"')
  })

  it("anything under the private store's place in the repository, whatever the ignore rules say", async () => {
    setup()
    mkdirSync(join(repo, 'memory', 'store'), { recursive: true })
    writeFileSync(join(repo, 'memory', 'store', 'notes.md'), 'STORE-PLACE-SECRET\n'); commit('a tracked file where the store sits')
    process.env.ORG_OS_PRIVATE_DIR = 'memory/store'
    await readsAsUngoverned('memory/store/notes.md', 'STORE-PLACE-SECRET')
  })

  it('an untracked file answers the ungoverned 404', async () => {
    setup()
    mkdirSync(join(repo, 'docs', 'plans'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'plans', 'draft.md'), 'UNTRACKED DRAFT')
    await readsAsUngoverned('docs/plans/draft.md', 'UNTRACKED DRAFT')
  })

  it('a committed link to a file outside the repository is not followed', async () => {
    setup()
    writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-THE-REPO-SECRET')
    mkdirSync(join(repo, 'memory'), { recursive: true })
    symlinkSync(join(outside, 'secret.txt'), join(repo, 'memory', 'link.md')); commit('link')
    await readsAsUngoverned('memory/link.md', 'OUTSIDE-THE-REPO-SECRET')
  })

  it('a committed link to a file inside the repository is not followed either', async () => {
    setup()
    mkdirSync(join(repo, 'memory'), { recursive: true })
    symlinkSync('../data/finances.yaml', join(repo, 'memory', 'inner.md')); commit('inner link')
    await readsAsUngoverned('memory/inner.md', 'finances:')
  })

  it('a file under a linked folder is not served', async () => {
    setup()
    writeFileSync(join(outside, 'x.yaml'), 'secret: DIR-LINK-SECRET\n')
    symlinkSync(outside, join(repo, 'data', 'collections'))
    await readsAsUngoverned('data/collections/x.yaml', 'DIR-LINK-SECRET')
  })

  it('what was served stays served: a committed file, and a governed path with no file yet', async () => {
    setup()
    const text = readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')
    expect(await (await app.request('/api/files?path=data/governance.yaml')).json())
      .toEqual({ path: 'data/governance.yaml', text, base: blobId(text), class: 'governance', editor: 'rules+source' })
    expect(await (await app.request('/api/files?path=memory/new.md')).json())
      .toEqual({ path: 'memory/new.md', text: null, base: null, class: 'workspace', editor: 'source' })
  })
})

describe('a file op on such a path is refused at stage and at apply, nothing written (T19 review I1, M2)', () => {
  it('an ignored file: refused at stage', async () => {
    setup()
    writeFileSync(join(repo, '.gitignore'), 'memory/local/\n'); commit('ignore')
    mkdirSync(join(repo, 'memory', 'local'), { recursive: true })
    writeFileSync(join(repo, 'memory', 'local', 'n.md'), 'LOCAL ONLY\n')
    await stageRefused('memory/local/n.md')
    expect(readFileSync(join(repo, 'memory', 'local', 'n.md'), 'utf8')).toBe('LOCAL ONLY\n')
  })

  it('an untracked file: refused at stage', async () => {
    setup()
    mkdirSync(join(repo, 'docs', 'plans'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'plans', 'draft.md'), 'UNTRACKED DRAFT')
    await stageRefused('docs/plans/draft.md')
    expect(readFileSync(join(repo, 'docs', 'plans', 'draft.md'), 'utf8')).toBe('UNTRACKED DRAFT')
  })

  it('a link to a file outside: refused at stage, the file outside untouched', async () => {
    setup()
    writeFileSync(join(outside, 'target.txt'), 'ORIGINAL')
    mkdirSync(join(repo, 'memory'), { recursive: true })
    symlinkSync(join(outside, 'target.txt'), join(repo, 'memory', 'link.md')); commit('link')
    await stageRefused('memory/link.md')
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('ORIGINAL')
  })

  it('a new file under a linked folder: refused at stage, nothing made outside', async () => {
    setup()
    symlinkSync(outside, join(repo, 'data', 'collections'))
    await stageRefused('data/collections/new.yaml')
    expect(existsSync(join(outside, 'new.yaml'))).toBe(false)
  })

  it('a change that already holds such an op is refused at apply, nothing written, no commit', async () => {
    setup()
    writeFileSync(join(outside, 'target.txt'), 'ORIGINAL')
    mkdirSync(join(repo, 'memory'), { recursive: true })
    symlinkSync(join(outside, 'target.txt'), join(repo, 'memory', 'link.md'))
    writeFileSync(join(repo, '.gitignore'), 'memory/local/\n'); commit('link and ignore')
    const before = commits()
    const now = new Date().toISOString()
    for (const path of ['memory/link.md', 'memory/local/n.md']) {
      new ChangeStore(repo).save({ id: 'chg_held', actor: 'steward-a', created: now, updated: now, ops: [{ op: 'file', path, text: 'OVERWRITTEN\n', base: null }] })
      const res = await app.request('/api/changes/apply', json({}))
      expect(res.status).toBe(422)
      expect(JSON.stringify(await res.json())).toContain(UNGOVERNED(path))
    }
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('ORIGINAL')
    expect(existsSync(join(repo, 'memory', 'local', 'n.md'))).toBe(false)
    expect(commits()).toBe(before)
  })

  it('a new file in a governed folder is still staged and applied', async () => {
    setup()
    const before = commits()
    expect((await app.request('/api/changes/ops', json({ ops: [{ op: 'file', path: 'memory/new.md', text: 'NEW\n', base: null }] }))).status).toBe(200)
    expect((await app.request('/api/changes/apply', json({}))).status).toBe(200)
    expect(readFileSync(join(repo, 'memory', 'new.md'), 'utf8')).toBe('NEW\n')
    expect(commits()).toBe(before + 1)
  })
})
