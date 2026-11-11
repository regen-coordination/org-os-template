import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { makeNotionExport, nid } from '../fixtures/notion-export.ts'
import { openPrivateStore } from '../../server/private/store.ts'
import { applyImport, planImport } from '../../server/workspace/imports.ts'
import { readNotionExport } from '../../lib/imports/notion.mjs'
import { readFileverse } from '../../lib/imports/fileverse.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'
import { addressOfKey, key, sign } from '../session/keys.ts'
import { startServer, type Running } from '../../server/serve.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import { encodeArgs, selector } from '../../lib/abi.mjs'
import { HATS_SIGNATURES, VIEW_HAT_TYPES, childHatId, hatRef, topHatId } from '../../lib/hats.mjs'

// L5 spec §10.5's third enforcement (house spec §11 rule 4): nothing stricter than members enters git, in any object of
// the repository's history. One scripted session on a real server (startServer on a free port, a fresh temporary
// repository, a private store in a temp folder of its own, a fake fetch standing in for the Celo node and its explorer):
// sign-in with test keys (an off-chain SIWE signature; nothing is sent on chain), a private record and a restricted field
// staged and applied, a person's e-mail (defaults.contact) and wallet link proposed, approved by two Council wearers and
// ratified, a public record narrowed to Ops (C-14: it carries no sentinel while in git) and then written at its new level,
// and a restart (reconcile). DAO-OS L6 Task 21 extends the session with the workspace (L6 §17 point 1): an imported
// private item (a Notion database the map keeps at Ops, imported before the server starts, as `npm run import` does), a
// private page, a comment with a mention (and so a notification) on a members page and a comment on the private page, a
// Council memory entry, and a private task moved into git by a publication decision whose restricted field stays in the
// store (and whose title before the move is in the store's history only). The final review's M-2 adds: a private
// collection defined through POST /api/collections, an imported private database's name and Notion id, a private Notion
// page, a Fileverse dDoc kept at Ops, a saved view of the private collection, and Turn into a task on the private page's
// comment. Every restricted value carries
// `sentinel-7f3a-<n>`; then every object `git rev-list --all --objects` names, and every object in the object store, is
// read through `git cat-file` and none may hold one. The control: a value at members level carries `visible-sentinel`,
// and the same scan finds it.

const CELO = 'eip155:42220'
const TOP_ID = topHatId(13)
const COUNCIL_ID = childHatId(TOP_ID, 1)
const TREASURER_ID = childHatId(TOP_ID, 2)
const OPS_ID = childHatId(COUNCIL_ID, 1)
const COUNCIL = hatRef(CELO, COUNCIL_ID)
const OPS = hatRef(CELO, OPS_ID)
const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))
const SENTINEL = 'sentinel-7f3a-'
const VISIBLE = 'visible-sentinel'
/** M-2: an imported private database's name, and its Notion id (32 hex, so a needle of its own in the scan). */
const VAULT = `Vault ${SENTINEL}14`
const VAULT_ID = '7f3a5e47' + '0'.repeat(20) + 'd014'

/** Records go to the store or git at once, by Ops; members' changes are proposed by Ops and approved by two Council
 *  wearers (one rule per class, so the two paths take two classes: R-L5-18.2). */
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  rules:
    - { id: records, applies_to: [records], propose: ops, decide: { by: ops, method: direct } }
    - { id: people, applies_to: [members], propose: ops, decide: { by: council, method: approve, count: 2 } }
    - { id: publish, applies_to: [publication], propose: ops, decide: { by: ops, method: direct } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"] } }
  - { id: steward-b, name: Steward B, kind: person, role: Contributor }
  - { id: steward-c, name: Steward C, kind: person }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - { id: p-open, title: "Open project", status: execute, type: program, visibility: public }
  - { id: p-two, title: "Second project", status: execute, type: program }
`
/** P15: contact details at defaults.contact, and so a person's wallet link (§9.7's default, R-L5-18.7: not declared
 *  here); a project's budget restricted to Ops. */
const VISIBILITY = `visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members, fields: { budget: "hat:${OPS}" } }
    members: { default: members }
    tasks: { default: members, fields: { budget: "hat:${OPS}" } }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-open, title: Write the agenda, status: todo }
`
/** A mention as the dialect writes one (L6 §5). */
const mention = (id: string) => `[@${id}](hub:member/${id})`
/** Ratify writes the statement here (a file git tracks). */
const DECISIONS = `# Decisions

## Conventions

Newest first. Each entry has an id, LD-<year>-<NNN>.

---
`

// ── the Celo node and its explorer, faked (ruling S13: no network in tests) ──

const lower = (address: string) => address.toLowerCase()
const word64 = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0')

/** The fixture tree (§17): Top, Council and Treasurer under it, Ops under Council. `wearers` maps a hat id to the
 *  addresses (lowercase) that wear it; the explorer lists them as its holders, and isWearerOfHat answers from it. */
function fakeChain(wearers: Record<string, string[]>): FetchLike {
  const children: Record<string, number> = { [word64(TOP_ID)]: 2, [word64(COUNCIL_ID)]: 1, [word64(TREASURER_ID)]: 0, [word64(OPS_ID)]: 0 }
  const worn = (hat: string) => Object.entries(wearers).find(([id]) => word64(id) === hat)?.[1] ?? []
  const VIEW = selector(HATS_SIGNATURES.viewHat), WEARER = selector(HATS_SIGNATURES.isWearerOfHat)
  const ZERO = '0x0000000000000000000000000000000000000000'
  const call = (data: string): string => {
    const at = (n: number) => data.slice(10 + 64 * n, 10 + 64 * (n + 1))
    if (data.startsWith(VIEW)) {
      const hat = at(0)
      if (!(hat in children)) return encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, true, true])
      return encodeArgs(VIEW_HAT_TYPES, ['a hat of the fixture tree', 10, worn(hat).length, ZERO, ZERO, '', children[hat], true, true])
    }
    if (data.startsWith(WEARER)) return encodeArgs(['bool'], [worn(at(1)).includes(`0x${at(0).slice(24)}`)])
    throw new Error(`the fake node was asked an eth_call it does not know: ${data.slice(0, 10)}`)
  }
  return async (url, init) => {
    if (init.method === 'GET') {
      const m = /\/instances\/(\d+)\/holders$/.exec(url)
      if (!m) return { ok: false, status: 404, json: async () => ({}) }
      const items = worn(word64(BigInt(m[1]!).toString(16))).map(hash => ({ address: { hash } }))
      return { ok: true, status: 200, json: async () => ({ items, next_page_params: null }) }
    }
    const body = JSON.parse(init.body!)
    const answer = (Array.isArray(body) ? body : [body]).map((r: { id: number; method: string; params: [{ data: string }] }) => {
      const result = r.method === 'eth_blockNumber' ? '0x64' : r.method === 'eth_chainId' ? '0xa4ec' : r.method === 'eth_getCode' ? '0x' : call(r.params[0].data)
      return { jsonrpc: '2.0', id: r.id, result }
    })
    return { ok: true, status: 200, json: async () => (Array.isArray(body) ? answer : answer[0]) }
  }
}

// ── the house, over HTTP ──

const cleanup: string[] = []
const servers: Running[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const s of servers.splice(0)) await s.close().catch(() => {})
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function http(server: Running, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  const res = await fetch(`http://localhost:${server.port}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
  return { status: res.status, text: await res.text(), cookie: res.headers.get('set-cookie') }
}
async function ok(server: Running, method: string, path: string, o: { body?: unknown; cookie?: string; status?: number } = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await http(server, method, path, o)
  expect([method, path, res.status, res.status === (o.status ?? 200) ? '' : res.text]).toEqual([method, path, o.status ?? 200, ''])
  return JSON.parse(res.text)
}
/** Sign-in (§4): a nonce for the key's address, its SIWE message signed off chain with the test key, the session cookie. */
async function signIn(server: Running, sk: Uint8Array): Promise<string> {
  const { nonce, message } = await ok(server, 'POST', '/api/session/nonce', { body: { address: addressOfKey(sk) } })
  const res = await http(server, 'POST', '/api/session', { body: { nonce, signature: sign(sk, message) } })
  expect([res.status, res.text]).toEqual([200, expect.stringContaining('"signedIn":true')])
  return /house_session=[^;]*/.exec(res.cookie ?? '')![0]
}
/** A ratify is judged at the start of the current second (git dates commits in whole seconds): one just after the last
 *  approval can be "not met yet", and is tried again a second later. */
async function ratify(server: Running, id: string, cookie: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let tries = 0; ; tries++) {
    const res = await http(server, 'POST', `/api/proposals/${id}/ratify`, { cookie })
    if (res.status === 409 && JSON.parse(res.text).code === 'NOT_MET' && tries < 3) { await new Promise(r => setTimeout(r, 1100)); continue }
    expect([res.status, res.status === 200 ? '' : res.text]).toEqual([200, ''])
    return JSON.parse(res.text)
  }
}

// ── the scan ──

interface GitObject { sha: string; type: string; path: string; content: Buffer }

/** git with its arguments as given (no shell: a format such as %(objectname) stays one argument). */
const gitText = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')

/** Every object `shas` names, read in one `git cat-file --batch`: blobs and trees raw (a tree holds its entries' names),
 *  commits whole (headers, trailers, message). */
function catFile(repo: string, shas: string[], paths: Map<string, string>): GitObject[] {
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input: shas.join('\n') + '\n', maxBuffer: 1 << 28 })
  const objects: GitObject[] = []
  let at = 0
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at)
    const [sha, type, size] = out.subarray(at, eol).toString('utf8').split(' ')
    if (type === 'missing' || size === undefined) throw new Error(`git cat-file could not read ${sha}`)
    const content = out.subarray(eol + 1, eol + 1 + Number(size))
    objects.push({ sha: sha!, type: type!, path: paths.get(sha!) ?? '', content })
    at = eol + 1 + Number(size) + 1
  }
  return objects
}
/** Every object of the history (`git rev-list --all --objects`: each ref's commits, their trees and blobs), and every
 *  object in the store besides (`--batch-all-objects`: one no ref reaches still sits in .git), each read once. */
function everyObject(repo: string): { reachable: number; objects: GitObject[] } {
  const paths = new Map<string, string>()
  for (const line of gitText(repo, 'rev-list', '--all', '--objects').split('\n').filter(Boolean)) {
    const space = line.indexOf(' ')
    paths.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1))
  }
  const all = gitText(repo, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split('\n').filter(Boolean)
  return { reachable: paths.size, objects: catFile(repo, [...new Set([...paths.keys(), ...all])], paths) }
}
/** Every file under .git but the object store (read above through cat-file): the index, logs, refs, config, the last
 *  commit message, a proposal build's worktree records. */
function gitFiles(repo: string): { path: string; content: Buffer }[] {
  const root = join(repo, '.git')
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => join(e.parentPath, e.name))
    .filter(p => !p.startsWith(join(root, 'objects') + '/'))
    .map(p => ({ path: p.slice(repo.length + 1), content: readFileSync(p) }))
}
/** Where any of `needles` (compared without case) appears: in an object, in a ref's name, or in a file under .git. */
function scan(repo: string, objects: GitObject[], needles: string[]): { needle: string; sha: string; type: string; path: string }[] {
  const hits: { needle: string; sha: string; type: string; path: string }[] = []
  for (const f of gitFiles(repo)) {
    const text = f.content.toString('latin1').toLowerCase()
    for (const needle of needles) if (text.includes(needle.toLowerCase())) hits.push({ needle, sha: '', type: 'file', path: f.path })
  }
  for (const o of objects) {
    const text = o.content.toString('latin1').toLowerCase()
    for (const needle of needles) if (text.includes(needle.toLowerCase())) hits.push({ needle, sha: o.sha, type: o.type, path: o.path })
  }
  for (const ref of gitText(repo, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean)) {
    for (const needle of needles) if (ref.toLowerCase().includes(needle.toLowerCase())) hits.push({ needle, sha: '', type: 'ref', path: ref })
  }
  return hits
}
const validator = (script: string, ...args: string[]) => spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: FRAMEWORK, encoding: 'utf8' })

describe('nothing stricter than members enters git (L5 spec §10.5, its third enforcement)', () => {
  it('a scripted session leaves no restricted value in any object of the repository\'s history; a members value is found', async () => {
    // A fresh repository: the fixture's data and the rules in one commit over its root (the root and a history with no
    // written rules before it are not judged), so validate:governance can judge the whole history the house writes.
    const repo = makeFixtureRepo(); cleanup.push(repo)
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
    writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
    writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS)
    writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, the rules, three members, two projects, a task, the policy"')
    const privateDir = mkdtempSync(join(tmpdir(), 'never-in-git-')); cleanup.push(privateDir)
    vi.stubEnv('ORG_OS_PRIVATE_DIR', privateDir)

    // 0. An import with a private part (L6 Task 21), while no server runs (the import command's own condition): a
    //    synthetic Notion export whose one database the map keeps at Ops; its rows, their pages and its id go to the store.
    //    M-2: the database's name and its Notion id are the Ops's too (a Notion id is hex: its own needle in the scan), and
    //    a page at the top of the export the map keeps at Ops (`docs:`) beside one that lands members (the control).
    const exportDir = mkdtempSync(join(tmpdir(), 'never-in-git-export-')); cleanup.push(exportDir)
    makeNotionExport(exportDir, { pages: [
      { title: 'Season notes', id: nid('a', 9), body: `Open notes, ${VISIBLE}.\n` },
      { title: `Pay review ${SENTINEL}15`, id: nid('b', 9), body: `The figures, ${SENTINEL}15.\n` },
    ], databases: [{
      name: VAULT, id: VAULT_ID, columns: ['Name', 'Notes'],
      rows: [{ title: `Ledger ${SENTINEL}7`, id: nid('e', 9), cells: { Notes: `${SENTINEL}7 note` }, body: `The ledger ${SENTINEL}7.\n` }],
    }] })
    //    M-2: a Fileverse pull whose one dDoc the map keeps at Ops: its name (the folder), its tab's title and text.
    const pullDir = mkdtempSync(join(tmpdir(), 'never-in-git-pull-')); cleanup.push(pullDir)
    const DDOC = `council-${SENTINEL}16`
    const tabText = `What the council weighs, ${SENTINEL}16.\n`
    mkdirSync(join(pullDir, DDOC))
    writeFileSync(join(pullDir, DDOC, 'agenda.md'), `---\ntitle: "Agenda ${SENTINEL}16"\nfileverse_doc: ${DDOC}\nfileverse_tab: "1-agenda"\n` +
      `pulled_at: 2026-11-02\ncontent_sha256: ${sha256Hex(tabText)}\n---\n\n${tabText}`)
    {
      const store = await openPrivateStore(repo, { dir: privateDir })
      const by = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' } as const
      const plan = planImport(readNotionExport(exportDir, { exported: '2026-11-01' }),
        { databases: { [VAULT]: { level: `hat:${OPS}` } }, docs: { [nid('b', 9)]: { level: `hat:${OPS}` } } }, repo, store)
      await applyImport(repo, plan, by, store)
      const pulled = planImport(readFileverse(pullDir, { exported: '2026-11-02' }), { docs: { [DDOC]: { level: `hat:${OPS}` } } }, repo, store)
      await applyImport(repo, pulled, by, store)
      store.close()
    }

    // Test keys: Ops signs in and does everything but decide; two Council wearers approve. The wallet link's value is the
    // address of a fourth key that never signs: an address must stay an address, so it is its own sentinel (R-L5-18.3).
    const opsKey = key(), councilOne = key(), councilTwo = key()
    const linked = addressOfKey(key())
    const LINK = `${CELO}:${linked}`
    const fetch = fakeChain({
      [TOP_ID]: [], [TREASURER_ID]: [],
      [COUNCIL_ID]: [lower(addressOfKey(councilOne)), lower(addressOfKey(councilTwo))],
      [OPS_ID]: [lower(addressOfKey(opsKey))],
    })
    const s1 = await startServer({ repo, port: 0, fetch }); servers.push(s1)
    const opsId = `${CELO}:${addressOfKey(opsKey)}`

    const ops = await signIn(s1, opsKey)
    const council = [await signIn(s1, councilOne), await signIn(s1, councilTwo)]

    // P15: a private collection, defined through POST /api/collections at Ops (M-2). Its id is never named in git
    // (§9.2), so it carries a sentinel too, as its name does.
    const GRANTS = `grants-${SENTINEL}1`
    expect(await ok(s1, 'POST', '/api/collections', { cookie: ops, status: 201, body: { id: GRANTS, name: `Grants ${SENTINEL}1`, visibility: `hat:${OPS}` } }))
      .toEqual({ id: GRANTS, visibility: `hat:${OPS}` })
    // M-2: a saved view of it, whose filter's value is the Ops's too.
    await ok(s1, 'PUT', `/api/collections/${GRANTS}/views/large`, { cookie: ops, body: { name: `Large ${SENTINEL}17`, kind: 'table', filters: [{ field: 'amount', op: 'contains', value: `${SENTINEL}17` }] } })

    // 1. Staged and applied at once (records, direct): a private record, and one change to a git record whose title is
    //    members' (the control, `visible-sentinel`) and whose budget is Ops's.
    await ok(s1, 'POST', '/api/changes/ops', { cookie: ops, body: { ops: [
      { op: 'create', record: `${GRANTS}:g-${SENTINEL}2`, value: { id: `g-${SENTINEL}2`, title: `A grant ${SENTINEL}2`, amount: `${SENTINEL}2 EUR` } },
      { op: 'update', record: 'projects:p-two', set: { title: `Second project, ${VISIBLE}`, budget: `${SENTINEL}3 EUR a year` } },
    ] } })
    await ok(s1, 'POST', '/api/changes/apply', { cookie: ops })

    // 2. Proposed, approved by two Council wearers, ratified (members, approve 2): a person's e-mail (kept at
    //    defaults.contact) and wallet link, beside a git change. Title, rationale and statement are members' text.
    await ok(s1, 'POST', '/api/changes/ops', { cookie: ops, body: { ops: [
      { op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: `steward-b.${SENTINEL}4@example.invalid`, wallet: LINK } },
    ] } })
    const proposal = await ok(s1, 'POST', '/api/proposals', { cookie: ops, status: 201, body: {
      title: 'Steward B keeps the treasury',
      rationale: 'Ops needs to reach whoever keeps the treasury.',
      statement: { title: 'Steward B keeps the treasury', decision: 'Steward B is the treasurer; their contact details are kept for Ops.', why: 'The treasury needs a keeper.', scope: 'members' },
    } })
    const id = String(proposal.id)
    for (const cookie of council) await ok(s1, 'POST', `/api/proposals/${id}/events`, { cookie, body: { kind: 'approve' } })
    await ratify(s1, id, ops)

    // 3. A public record narrowed to Ops (C-14): it carries no sentinel while it is in git. It leaves git; a value written
    //    to it at its new level goes to the store, and carries one.
    expect(await ok(s1, 'POST', '/api/visibility/narrow', { cookie: ops, body: { target: { registry: 'projects', id: 'p-open' }, level: `hat:${OPS}` } }))
      .toMatchObject({ moved: true })
    await ok(s1, 'POST', '/api/changes/ops', { cookie: ops, body: { ops: [{ op: 'update', record: 'projects:p-open', set: { title: `Open project ${SENTINEL}5` } }] } })
    await ok(s1, 'POST', '/api/changes/apply', { cookie: ops })

    // 3b. The workspace (L6 Task 21). A private page at Ops (a store record, no commit); a members page (one commit) with a
    //     comment mentioning Steward C, who is told (a notification), and a comment on the private page; a Council memory
    //     entry written by a Council wearer at Council.
    const privatePage = (await ok(s1, 'POST', '/api/pages', { cookie: ops, status: 201, body: {
      title: `Ops plan ${SENTINEL}6`, visibility: `hat:${OPS}`, markdown: `Salaries, ${SENTINEL}6.\n` } })).id as string
    const page = (await ok(s1, 'POST', '/api/pages', { cookie: ops, status: 201, body: { title: 'Open notes', markdown: `Notes every member reads, ${VISIBLE}.\n` } })).id as string
    await ok(s1, 'POST', '/api/comments', { cookie: ops, status: 201, body: { target: `page:${page}`, body: `${mention('steward-c')} the figure is ${SENTINEL}9` } })
    const onPlan = (await ok(s1, 'POST', '/api/comments', { cookie: ops, status: 201, body: { target: `page:${privatePage}`, body: `On the plan: ${SENTINEL}10` } })).comment.id as string
    // M-2: Turn into a task on the private page's comment: a private task at the page's level, its title the comment's.
    const task = await ok(s1, 'POST', `/api/comments/${onPlan}/task`, { cookie: ops, status: 201 })
    expect(task).toEqual({ task: expect.stringMatching(/^t-[0-9a-f]{12}$/), visibility: `hat:${OPS}` })
    await ok(s1, 'POST', '/api/memory', { cookie: council[0], status: 201, body: {
      level: `hat:${COUNCIL}`, date: '2026-11-05', title: `Council talk ${SENTINEL}11`, body: `What was said, ${SENTINEL}11.\n` } })
    // 3c. A private task moved into git by a publication decision (the publish rule lets Ops decide alone): its git part goes
    //     into data/tasks.yaml in one commit; its budget, restricted to Ops, stays in the store as a field row, and its title
    //     before the move is in the store's history only.
    await s1.privateStore!.putRecord({ collection: 'tasks', id: 't-move', visibility: `hat:${OPS}`, body: { id: 't-move', title: `Old title ${SENTINEL}13`, status: 'todo' }, rev: '' }, opsId, null)
    await s1.privateStore!.putRecord({ collection: 'tasks', id: 't-move', visibility: `hat:${OPS}`, body: { id: 't-move', title: 'Review the grant', status: 'todo', budget: `${SENTINEL}12 EUR` }, rev: '' }, opsId, null)
    await ok(s1, 'POST', '/api/changes/ops', { cookie: ops, body: { ops: [{ op: 'update', record: 'tasks:t-move', set: { visibility: 'members' } }] } })
    await ok(s1, 'POST', '/api/changes/apply', { cookie: ops })

    // 4. The server restarts on the same repository and store (reconcile, §10.3). Every restricted value is there, read
    //    by Ops through the gate: the sentinels exist, and the scan below is not looking for values never written.
    await s1.close(); servers.splice(servers.indexOf(s1), 1)
    const s2 = await startServer({ repo, port: 0, fetch }); servers.push(s2)
    const again = await signIn(s2, opsKey)
    const projects = (await ok(s2, 'GET', '/api/registries/projects', { cookie: again })).entries
    expect(projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'p-open', title: `Open project ${SENTINEL}5`, visibility: `hat:${OPS}` }),
      expect.objectContaining({ id: 'p-two', title: `Second project, ${VISIBLE}`, budget: `${SENTINEL}3 EUR a year` }),
    ]))
    const members = (await ok(s2, 'GET', '/api/registries/members', { cookie: again })).entries
    expect(members.find((m: { id: string }) => m.id === 'steward-b')).toMatchObject({ role: 'Treasurer', email: `steward-b.${SENTINEL}4@example.invalid`, wallet: LINK })
    expect((await ok(s2, 'GET', `/api/registries/${GRANTS}`, { cookie: again })).entries)
      .toEqual([expect.objectContaining({ id: `g-${SENTINEL}2`, amount: `${SENTINEL}2 EUR` })])
    // The workspace's (L6 Task 21): each kind is held, with its sentinel, where it belongs.
    const store = s2.privateStore!
    const vault = store.collections().find(c => c.id.startsWith('notion-vault'))
    expect(vault?.visibility).toBe(`hat:${OPS}`)
    expect(vault?.definition).toMatchObject({ name: VAULT, from: { id: VAULT_ID } })
    expect(store.records(vault!.id).map(r => r.body.title)).toEqual([`Ledger ${SENTINEL}7`])
    const privatePages = store.records('pages').map(r => ({ title: String(r.body.title), visibility: r.visibility }))
    expect(privatePages).toEqual(expect.arrayContaining([{ title: `Pay review ${SENTINEL}15`, visibility: `hat:${OPS}` },
      { title: DDOC, visibility: `hat:${OPS}` }, { title: `Agenda ${SENTINEL}16`, visibility: `hat:${OPS}` }]))
    expect(store.collections().find(c => c.id === GRANTS)?.definition).toMatchObject({ name: `Grants ${SENTINEL}1`,
      views: [expect.objectContaining({ id: 'large', filters: [{ field: 'amount', op: 'contains', value: `${SENTINEL}17` }] })] })
    expect(store.record('tasks', task.task)?.body).toMatchObject({ title: `On the plan: ${SENTINEL}10`, page: privatePage })
    expect(store.record('pages', privatePage)?.body).toMatchObject({ title: `Ops plan ${SENTINEL}6`, markdown: `Salaries, ${SENTINEL}6.\n` })
    expect(store.comments(`page:${page}`).map(c => c.body)).toEqual([`${mention('steward-c')} the figure is ${SENTINEL}9`])
    expect(store.comments(`page:${privatePage}`).map(c => c.body)).toEqual([`On the plan: ${SENTINEL}10`])
    expect(store.notifications('steward-c')).toHaveLength(1)
    expect(store.records('council-memory').map(r => r.body.title)).toEqual([`Council talk ${SENTINEL}11`])
    expect(store.record('tasks', 't-move')).toBeNull()
    expect(store.fields('tasks', 't-move')).toEqual([expect.objectContaining({ field: 'budget', visibility: `hat:${OPS}`, value: `${SENTINEL}12 EUR` })])
    expect(gitText(repo, 'show', 'HEAD:data/tasks.yaml')).toContain('Review the grant')
    await s2.close(); servers.splice(servers.indexOf(s2), 1)

    // 5. The scan: every object of the history, and every object in the store, read through git cat-file.
    //    Nothing is left in the working tree for a later `git add` to commit, and nothing is in the files under .git.
    expect(gitText(repo, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    const { reachable, objects } = everyObject(repo)
    expect(reachable).toBeGreaterThan(0)
    expect(new Set(objects.map(o => o.type))).toEqual(new Set(['commit', 'tree', 'blob']))
    expect(scan(repo, objects, [SENTINEL, linked.slice(2), VAULT_ID])).toEqual([])
    // The control: the members-level value is found by the same scan, in the projects file the apply committed.
    expect(scan(repo, objects, [VISIBLE])).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'blob', path: 'data/projects.yaml' }),
      expect.objectContaining({ type: 'blob', path: `pages/${page}.md` })]))

    // 6. The validators on the repository: no errors.
    const data = validator('validate-data.mjs', repo)
    expect(data.status, `${data.stdout}\n${data.stderr}`).toBe(0)
    const governance = validator('validate-governance.mjs', repo, '--strict')
    expect(governance.status, `${governance.stdout}\n${governance.stderr}`).toBe(0)
  }, 180_000)
})
