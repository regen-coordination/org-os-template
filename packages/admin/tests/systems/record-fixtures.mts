// An operator-run recorder (DAO-OS L2, Task 14). Not a test: vitest never runs it, and it refuses to.
//
//   npx tsx tests/systems/record-fixtures.mts record <out-dir>      read the real public answers once, one JSON per request
//   npx tsx tests/systems/record-fixtures.mts compare <out-dir>     key paths of the recorded answers against the synthetic fixtures
//   npx tsx tests/systems/record-fixtures.mts synthetic <out-dir>   the synthetic fixtures themselves, written as a recording (a self-check of compare)
//
// `record` goes through the real drivers (their own URL and body builders, their read-only guards) with `globalThis.fetch`,
// one request a second to a host, and writes nothing into any git working tree: an <out-dir> inside one is refused.
// Each file carries its source URL, the read date and, for a chain read, the block. The recorded answers are never committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardedFetch, guardedPost, type Driver, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { safe } from '../../server/systems/safe.ts'
import { hatsTree } from '../../server/systems/hats.ts'
import { snapshotSpace } from '../../server/systems/snapshot.ts'
import { gardensCommunity, gardensPool } from '../../server/systems/gardens.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const GAP_MS = 1_000

// Example DAO's public contracts and spaces (the brief's list).
const TREASURY_SAFE = '0x6AFFe5105DE869fE4A27b3353468eFb51a55343a'
const SAFE_CHAINS = ['eip155:42220', 'eip155:1', 'eip155:10', 'eip155:100', 'eip155:137', 'eip155:8453', 'eip155:42161']
const HATS_TREE = '13'
const SNAPSHOT_SPACE = 'exampledao.eth'
const GARDENS_COMMUNITY = '0x6e3a7cc815ceef39cd1cce8dcd65d98bbcc4d681'
const GARDENS_POOLS = ['0x5d0b8119883e462d5f830c50ff2b79d492278a5c', '0xeb52c78bc7dc351a6e95e105841023bf8c97f20c']
const CELO = 'eip155:42220'

interface Recorded { source: string; readAt: string; method: 'GET' | 'POST'; request?: unknown; status: number | null; block?: number | null; answer?: unknown; text?: string; error?: string }

function refuseUnsafe(outDir: string): void {
  if (process.env.VITEST) { console.error('refused: this recorder reads the network and never runs under vitest'); process.exit(2) }
  let at = resolve(outDir)
  while (!existsSync(at)) at = dirname(at)
  try {
    execFileSync('git', ['-C', at, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
  } catch { return }
  console.error(`refused: ${outDir} is inside a git working tree; record into a directory outside every repository`)
  process.exit(2)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------------------------------------------------

/** What a recorded request is called: safe by chain and kind, everything else by system and kind with a counter. */
function nameFor(prefix: string, url: string, body: unknown, counts: Map<string, number>): string {
  const u = new URL(url)
  let base: string
  const safeM = /^\/tx-service\/([a-z0-9]+)\/api\/(v\d)\/(.*)$/.exec(u.pathname)
  if (safeM) {
    const rest = safeM[3]!
    const kind = /^safes\/0x[0-9a-fA-F]{40}\/$/.test(rest) ? 'info' : /\/balances\/$/.test(rest) ? 'balances' : /\/multisig-transactions\/$/.test(rest) ? 'transactions' : 'other'
    base = `safe-${safeM[1]}-${kind}`
  } else if (body === undefined) base = `${prefix}-get`
  else if (Array.isArray(body)) base = `${prefix}-rpc`
  else base = `${prefix}-graphql`
  const n = (counts.get(base) ?? 0) + 1
  counts.set(base, n)
  return n === 1 && base.startsWith('safe-') ? base : `${base}-${String(n).padStart(2, '0')}`
}

/** A JSON value whose reads are noted: a key the code asks for that the answer does not have. */
function tracked(value: unknown, path: string, absent: Set<string>): unknown {
  if (typeof value !== 'object' || value === null) return value
  const isArray = Array.isArray(value)
  return new Proxy(value as object, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      if (!Reflect.has(target, prop)) {
        if (!['toJSON', 'then', 'asymmetricMatch', '$$typeof', 'nodeType'].includes(prop)) absent.add(path === '' ? prop : `${path}.${prop}`)
        return undefined
      }
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'object' || v === null) return v
      if (isArray) return /^\d+$/.test(prop) ? tracked(v, `${path}[]`, absent) : v
      return tracked(v, path === '' ? prop : `${path}.${prop}`, absent)
    },
  })
}

async function record(outDir: string): Promise<number> {
  refuseUnsafe(outDir)
  mkdirSync(outDir, { recursive: true })
  // The run's own date (UTC): a recording says when it was made.
  const readAt = new Date().toISOString().slice(0, 10)
  const last = new Map<string, number>()
  const counts = new Map<string, number>()
  const absentByFile: Record<string, string[]> = {}
  const summary: { name: string; source: string; status: number | string }[] = []
  let current = 'x'
  let pendingName = ''

  const save = (name: string, r: Recorded) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(r, null, 2))

  /** globalThis.fetch, a second apart per host, every answer kept whole. */
  const recordingFetch: FetchLike = async (url, init) => {
    const name = pendingName
    const host = new URL(url).host
    const wait = (last.get(host) ?? -Infinity) + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    last.set(host, Date.now())
    const request = init.body === undefined ? undefined : JSON.parse(init.body)
    const res = await globalThis.fetch(url, init)
    const text = await res.text()
    let answer: unknown, parsed = true
    try { answer = JSON.parse(text) } catch { parsed = false }
    const block = Array.isArray(answer) ? Number(BigInt(String((answer as { id?: unknown; result?: unknown }[]).find(a => a?.id === 0)?.result ?? '0x0'))) : undefined
    save(name, { source: url, readAt, method: init.method, ...(request === undefined ? {} : { request }), status: res.status, ...(block ? { block } : {}), ...(parsed ? { answer } : { text: text.slice(0, 2000) }) })
    summary.push({ name, source: url, status: res.status })
    return { ok: res.ok, status: res.status, headers: res.headers, json: async () => { if (!parsed) throw new Error('not JSON'); return answer } }
  }

  const contextFor = (driver: Driver, members: Record<string, unknown>[] = []): DriverContext => {
    const controller = new AbortController()
    const get = guardedFetch(driver, recordingFetch, controller.signal)
    const post = guardedPost(driver, recordingFetch, controller.signal)
    const prepare = (url: string, body?: unknown) => {
      pendingName = nameFor(current, url, body, counts)
      return pendingName
    }
    const keep = (name: string, answer: unknown) => {
      const absent = new Set<string>()
      const wrapped = tracked(answer, '', absent)
      // The absent set fills as the driver reads; it is flushed at the end of the system's read.
      flushers.push(() => { if (absent.size > 0) absentByFile[name] = [...absent].sort() })
      return wrapped
    }
    return {
      fetchJson: async url => { const name = prepare(url); return keep(name, await get(url)) },
      postJson: async (url, body) => { const name = prepare(url, body); return keep(name, await post(url, body)) },
      rpcUrl: chain => (Object.hasOwn(CHAINS, chain) && CHAINS[chain]!.rpc ? `https://${CHAINS[chain]!.rpc}` : null),
      now: () => new Date(),
      members,
      sleep,
      timeLeftMs: () => 600_000,
    }
  }
  const flushers: (() => void)[] = []
  const failures: { system: string; error: string }[] = []
  const attempt = async <T,>(label: string, run: () => Promise<T>): Promise<T | null> => {
    current = label
    try { return await run() } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      failures.push({ system: label, error })
      save(`${label}-error-${String(failures.length).padStart(2, '0')}`, { source: label, readAt, method: 'GET', status: null, error })
      return null
    }
  }

  // Safe: info, balances and transactions on its seven chains.
  const safeRecord = { id: 'treasury', chain: SAFE_CHAINS[0], chains: SAFE_CHAINS.slice(1), address: TREASURY_SAFE }
  await attempt('safe', () => safe.read(safeRecord, contextFor(safe)))

  // Hats tree 13 on Celo: the viewHat batches, the holders pages.
  const hatsRecord = { id: 'hats', chain: CELO, address: HATS_TREE }
  await attempt('hats', () => hatsTree.read(hatsRecord, contextFor(hatsTree)))

  // Snapshot: the read document, then one closed proposal through the driver's outcome read.
  const snapRecord = { id: 'snapshot', space: SNAPSHOT_SPACE }
  await attempt('snapshot', () => snapshotSpace.read(snapRecord, contextFor(snapshotSpace)))
  try {
    const file = readdirSync(outDir).filter(f => f.startsWith('snapshot-graphql-')).sort()[0]
    const doc = file ? (JSON.parse(readFileSync(join(outDir, file), 'utf8')) as Recorded) : null
    const closed = (doc?.answer as { data?: { closed?: { id: string; choices: string[] }[] } } | undefined)?.data?.closed?.[0]
    if (closed && snapshotSpace.outcome) {
      const ref = { system: 'snapshot', id: closed.id, payload: { kind: 'snapshot-proposal', choice: closed.choices[0]! } }
      await attempt('snapshot', () => snapshotSpace.outcome!(snapRecord, ref as never, { ...contextFor(snapshotSpace), opened: '2020-01-01T00:00:00Z' }))
    } else failures.push({ system: 'snapshot', error: 'no closed proposal in the space read, so no proposal was read' })
  } catch (err) { failures.push({ system: 'snapshot', error: String(err) }) }

  // Gardens on Celo: the community, then each pool (and its proposal #1, through the driver's outcome read).
  await attempt('gardens-community', () => gardensCommunity.read({ id: 'gardens', chain: CELO, address: GARDENS_COMMUNITY }, contextFor(gardensCommunity)))
  for (const pool of GARDENS_POOLS) {
    const rec = { id: `pool-${pool.slice(2, 8)}`, chain: CELO, address: pool }
    await attempt(`gardens-pool-${pool.slice(2, 8)}`, () => gardensPool.read(rec, contextFor(gardensPool)))
    if (gardensPool.outcome) {
      const ref = { system: rec.id, id: `${pool}-1`, payload: { kind: 'gardens-proposal' } }
      await attempt(`gardens-pool-${pool.slice(2, 8)}`, () => gardensPool.outcome!(rec, ref as never, { ...contextFor(gardensPool), opened: '2020-01-01T00:00:00Z' }))
    }
  }

  for (const f of flushers) f()
  writeFileSync(join(outDir, '_read-absent.json'), JSON.stringify({ note: 'keys a driver asked for that the real answer did not have, by recorded file', readAt, absentByFile }, null, 2))
  writeFileSync(join(outDir, '_requests.json'), JSON.stringify({ readAt, requests: summary, failures }, null, 2))
  console.log(`${summary.length} requests recorded into ${outDir}`)
  for (const s of summary) console.log(`  ${String(s.status).padEnd(4)} ${s.name}  ${s.source}`)
  for (const f of failures) console.log(`  FAILED ${f.system}: ${f.error}`)
  return 0
}

// ---------------------------------------------------------------------------------------------------------------------
// synthetic: the fixtures, laid out as a recording
// ---------------------------------------------------------------------------------------------------------------------

const readJson = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))
const dirs = (d: string) => readdirSync(d).sort()

function envelope(source: string, answer: unknown, request?: unknown): Recorded {
  return { source, readAt: '2026-10-29', method: request === undefined ? 'GET' : 'POST', ...(request === undefined ? {} : { request }), status: 200, answer }
}

function rpcFromCalls(file: string): { request: unknown[]; answer: unknown[] } {
  const calls = readJson(file) as Record<string, string>
  const request: unknown[] = [{ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }]
  const answer: unknown[] = [{ jsonrpc: '2.0', id: 0, result: '0x1' }]
  Object.entries(calls).forEach(([k, v], i) => {
    const cut = k.search(/[|:]/)
    request.push({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: k.slice(0, cut), data: k.slice(cut + 1) }, 'latest'] })
    answer.push({ jsonrpc: '2.0', id: i + 1, result: v })
  })
  return { request, answer }
}

function synthetic(outDir: string): number {
  refuseUnsafe(outDir)
  mkdirSync(outDir, { recursive: true })
  const put = (name: string, r: Recorded) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(r, null, 2))
  for (const f of dirs(join(FIXTURES, 'safe-chains'))) {
    const slug = f.replace(/\.json$/, '')
    const d = readJson(join(FIXTURES, 'safe-chains', f))
    for (const [kind, v] of Object.entries(d)) put(`safe-${slug}-${kind}`, envelope(`synthetic:${slug}/${kind}`, v))
  }
  const c = (f: string) => readJson(join(FIXTURES, 'safe-celo', f))
  put('safe-celo-info', envelope('synthetic', c('safe.json')))
  put('safe-celo-balances', envelope('synthetic', c('balances.json')))
  put('safe-celo-transactions', envelope('synthetic', c('executed.json')))
  put('safe-celo-transactions-02', envelope('synthetic', c('pending.json')))
  let n = 0
  for (const f of dirs(join(FIXTURES, 'hats-celo', 'holders'))) put(`hats-get-${String(++n).padStart(2, '0')}`, envelope('synthetic', readJson(join(FIXTURES, 'hats-celo', 'holders', f))))
  for (const sys of ['hats-celo', 'gardens-celo']) {
    const { request, answer } = rpcFromCalls(join(FIXTURES, sys, 'calls.json'))
    put(`${sys.split('-')[0]}-rpc-01`, envelope('synthetic', answer, request))
  }
  n = 0
  for (const f of dirs(join(FIXTURES, 'snapshot'))) put(`snapshot-graphql-${String(++n).padStart(2, '0')}`, envelope('synthetic', readJson(join(FIXTURES, 'snapshot', f)), { query: 'synthetic' }))
  n = 0
  for (const f of dirs(join(FIXTURES, 'gardens-celo')).filter(f => f !== 'calls.json')) put(`gardens-graphql-${String(++n).padStart(2, '0')}`, envelope('synthetic', { data: readJson(join(FIXTURES, 'gardens-celo', f)) }, { query: 'synthetic' }))
  console.log(`the synthetic fixtures written as a recording into ${outDir}`)
  return 0
}

// ---------------------------------------------------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------------------------------------------------

type Kinds = Set<string>
/** Every key path of a JSON value: objects by `.key`, arrays by `[]` (the union of their elements), with what sits at each. */
function pathsOf(v: unknown, prefix = '', out = new Map<string, Kinds>()): Map<string, Kinds> {
  const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
  if (prefix !== '') (out.get(prefix) ?? out.set(prefix, new Set()).get(prefix)!).add(kind)
  if (Array.isArray(v)) for (const e of v) pathsOf(e, `${prefix}[]`, out)
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) pathsOf(x, prefix === '' ? k : `${prefix}.${k}`, out)
  return out
}

/** A GraphQL answer is compared by its data. */
const unwrap = (a: unknown): unknown => (typeof a === 'object' && a !== null && !Array.isArray(a) && 'data' in a && Object.keys(a).every(k => ['data', 'errors'].includes(k)) ? (a as { data: unknown }).data : a)

interface Entry { file: string; name: string; rec: Recorded; absent: string[] }

function load(dir: string): Entry[] {
  const absentFile = join(dir, '_read-absent.json')
  const absent = existsSync(absentFile) ? ((readJson(absentFile).absentByFile ?? {}) as Record<string, string[]>) : {}
  return dirs(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => {
    const name = f.replace(/\.json$/, '')
    return { file: f, name, rec: readJson(join(dir, f)) as Recorded, absent: absent[name] ?? [] }
  })
}

const dataKeys = (e: Entry): string => {
  const d = unwrap(e.rec.answer)
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? Object.keys(d).sort().join(',') : ''
}

interface Compared { hard: string[]; soft: string[]; extra: string[]; matched: string[] }

function diff(fixture: unknown, entries: Entry[], isGraphql: boolean): Compared {
  const fp = pathsOf(unwrap(fixture))
  const rp = new Map<string, Kinds>()
  for (const e of entries) for (const [p, k] of pathsOf(unwrap(e.rec.answer))) for (const x of k) (rp.get(p) ?? rp.set(p, new Set()).get(p)!).add(x)
  const hard: string[] = [], soft: string[] = []
  for (const [p, kinds] of fp) {
    if (rp.has(p)) continue
    // An array the real answer holds empty cannot show its elements' keys.
    const arrayAbove = [...p.matchAll(/\[\]/g)].map(m => p.slice(0, m.index)).find(a => rp.get(a)?.has('array') && ![...rp.keys()].some(q => q.startsWith(`${a}[]`)))
    const nullAbove = [...p.matchAll(/[.[]/g)].map(m => p.slice(0, m.index)).find(a => a !== '' && rp.get(a) !== undefined && [...rp.get(a)!].every(k => k === 'null'))
    if (nullAbove !== undefined) soft.push(`${p}  (unverifiable: the real ${nullAbove} is null)`)
    else if (arrayAbove !== undefined) soft.push(`${p}  (unverifiable: the real ${arrayAbove} is empty)`)
    else if ([...kinds].every(k => k === 'null')) soft.push(`${p}  (null in the fixture, absent in the real answer)`)
    else hard.push(p)
  }
  // Keys a driver asked for that the real answer lacks, and the fixture holds with a value.
  const asked = new Set<string>()
  for (const e of entries) for (const a of e.absent) {
    const p = isGraphql ? a.replace(/^data\./, '') : a
    if (p === 'errors' || p === 'data' || p === 'error' || p.startsWith('[]')) continue
    asked.add(p)
  }
  for (const p of asked) {
    const k = fp.get(p)
    if (k && ![...k].every(x => x === 'null') && !hard.includes(p) && !soft.some(s => s.startsWith(`${p} `))) hard.push(`${p}  (the driver asked for it; the real answer lacks it)`)
  }
  const extra = [...rp.keys()].filter(p => !fp.has(p))
  return { hard, soft, extra, matched: [...fp.keys()].filter(p => rp.has(p)) }
}

function selectors(entries: Entry[]): Map<string, { lengths: number[]; errors: number; total: number }> {
  const out = new Map<string, { lengths: number[]; errors: number; total: number }>()
  for (const e of entries) {
    const req = e.rec.request, ans = e.rec.answer
    if (!Array.isArray(req) || !Array.isArray(ans)) continue
    const byId = new Map<unknown, any>(ans.map((a: any) => [a?.id, a]))
    for (const r of req as any[]) {
      if (r?.method !== 'eth_call') continue
      const sel = String(r.params?.[0]?.data ?? '').slice(0, 10)
      const a = byId.get(r.id)
      const s = out.get(sel) ?? out.set(sel, { lengths: [], errors: 0, total: 0 }).get(sel)!
      s.total++
      if (a && typeof a.result === 'string') s.lengths.push((a.result.length - 2) / 2)
      else s.errors++
    }
  }
  return out
}

function compare(dir: string): number {
  if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); return 2 }
  const rec = load(dir)
  if (rec.length === 0) { console.error(`no recorded answers in ${dir}`); return 2 }
  let failures = 0
  const section = (title: string) => console.log(`\n## ${title}`)
  const show = (c: Compared | null, what: string, notRecorded?: string) => {
    if (!c) { console.log(`  ${what}: not recorded${notRecorded ? ` (${notRecorded})` : ''}`); return }
    console.log(`  ${what}: ${c.matched.length} paths match; ${c.hard.length} MISSING from the real answer; ${c.soft.length} unverifiable/null; ${c.extra.length} only in the real answer`)
    for (const p of c.hard) console.log(`    MISSING  ${p}`)
    for (const p of c.soft) console.log(`    note     ${p}`)
    for (const p of c.extra) console.log(`    extra    ${p}`)
    failures += c.hard.length
  }
  const byName = (re: RegExp) => rec.filter(e => re.test(e.name) && e.rec.status !== null && e.rec.answer !== undefined)

  section('Safe (info, balances, transactions)')
  for (const f of dirs(join(FIXTURES, 'safe-chains'))) {
    const slug = f.replace(/\.json$/, '')
    const d = readJson(join(FIXTURES, 'safe-chains', f))
    for (const kind of Object.keys(d)) {
      const es = byName(new RegExp(`^safe-${slug}-${kind}(-\\d+)?$`))
      const gone = rec.find(e => e.name.startsWith(`safe-${slug}-${kind}`))
      show(es.length ? diff(d[kind], es, false) : null, `safe-chains/${slug} ${kind}`, gone ? `HTTP ${gone.rec.status}` : 'no request')
    }
  }
  const celo = (f: string) => readJson(join(FIXTURES, 'safe-celo', f))
  for (const [file, kind] of [['safe.json', 'info'], ['balances.json', 'balances'], ['executed.json', 'transactions'], ['pending.json', 'transactions']] as const) {
    const es = byName(new RegExp(`^safe-celo-${kind}(-\\d+)?$`))
    show(es.length ? diff(celo(file), es, false) : null, `safe-celo/${file}`)
  }

  section('Hats (explorer holders pages, contract calls)')
  const holders = rec.filter(e => /^hats-get-/.test(e.name) && e.rec.answer !== undefined && e.rec.status === 200)
  for (const f of dirs(join(FIXTURES, 'hats-celo', 'holders'))) show(holders.length ? diff(readJson(join(FIXTURES, 'hats-celo', 'holders', f)), holders, false) : null, `hats-celo/holders/${f}`)
  failures += compareCalls('hats-celo', rec.filter(e => /^hats-rpc-/.test(e.name)))

  section('Snapshot (hub GraphQL)')
  const snap = rec.filter(e => /^snapshot-graphql-/.test(e.name) && e.rec.answer !== undefined && e.rec.status === 200)
  for (const f of dirs(join(FIXTURES, 'snapshot'))) {
    const fx = readJson(join(FIXTURES, 'snapshot', f))
    const key = Object.keys(unwrap(fx) as object).sort().join(',')
    const es = snap.filter(e => dataKeys(e) === key)
    show(es.length ? diff(fx, es, true) : null, `snapshot/${f}`, es.length ? undefined : `no answer with data keys ${key}`)
  }
  for (const e of rec.filter(e => /^snapshot-graphql-/.test(e.name))) if (e.rec.status !== 200 || (e.rec.answer as any)?.errors) console.log(`  request ${e.name}: HTTP ${e.rec.status}${(e.rec.answer as any)?.errors ? `, errors: ${JSON.stringify((e.rec.answer as any).errors).slice(0, 300)}` : ''}`)

  section('Gardens (subgraph GraphQL, contract calls)')
  const gard = rec.filter(e => /^gardens-.*graphql-/.test(e.name) && e.rec.answer !== undefined)
  for (const f of dirs(join(FIXTURES, 'gardens-celo')).filter(f => f !== 'calls.json')) {
    const fx = readJson(join(FIXTURES, 'gardens-celo', f))
    const key = Object.keys(fx).sort().join(',')
    const es = gard.filter(e => dataKeys(e) === key && e.rec.status === 200)
    show(es.length ? diff(fx, es, true) : null, `gardens-celo/${f}`, es.length ? undefined : `no answer with data keys ${key}`)
  }
  for (const e of rec.filter(e => /^gardens-.*graphql-/.test(e.name))) if (e.rec.status !== 200 || (e.rec.answer as any)?.errors) console.log(`  request ${e.name}: HTTP ${e.rec.status}${(e.rec.answer as any)?.errors ? `, errors: ${JSON.stringify((e.rec.answer as any).errors).slice(0, 300)}` : ''}`)
  failures += compareCalls('gardens-celo', rec.filter(e => /^gardens-.*rpc-/.test(e.name)))

  const bad = rec.filter(e => e.rec.status !== null && e.rec.status !== 200)
  const errs = rec.filter(e => e.rec.error)
  section('Requests that did not answer 200')
  if (bad.length + errs.length === 0) console.log('  none')
  for (const e of bad) console.log(`  ${e.rec.status}  ${e.name}  ${e.rec.source}`)
  for (const e of errs) console.log(`  read failed  ${e.name}: ${e.rec.error}`)
  console.log(`\n${failures === 0 ? 'OK' : 'FAIL'}: ${failures} key(s) a driver reads are missing from a recorded answer`)
  return failures === 0 ? 0 : 1

  function compareCalls(system: string, entries: Entry[]): number {
    const want = new Map<string, number[]>()
    for (const [k, v] of Object.entries(readJson(join(FIXTURES, system, 'calls.json')) as Record<string, string>)) {
      const sel = k.slice(k.search(/[|:]/) + 1).slice(0, 10)
      want.set(sel, [...(want.get(sel) ?? []), (v.length - 2) / 2])
    }
    const got = selectors(entries)
    let n = 0
    console.log(`  ${system}/calls.json (contract calls, by selector)`)
    for (const [sel, lens] of want) {
      const g = got.get(sel)
      if (!g) { console.log(`    ${sel}: no recorded call`); continue }
      const ok = g.lengths.length > 0
      if (!ok) { console.log(`    MISSING  ${sel}: every recorded call (${g.total}) was refused by the node`); n++; continue }
      const same = lens.some(l => g.lengths.includes(l))
      console.log(`    ${sel}: ${g.total} recorded, ${g.errors} refused; answer bytes fixture ${[...new Set(lens)].join('/')} vs real ${[...new Set(g.lengths)].join('/')}${same ? '' : '  (no length in common)'}`)
    }
    for (const sel of got.keys()) if (!want.has(sel)) console.log(`    extra    ${sel}: recorded, not in the fixture`)
    return n
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const [cmd, dir] = process.argv.slice(2)
if (!dir || !['record', 'compare', 'synthetic'].includes(cmd ?? '')) {
  console.error('usage: tsx tests/systems/record-fixtures.mts record|compare|synthetic <out-dir>')
  process.exit(2)
}
process.exitCode = cmd === 'record' ? await record(dir) : cmd === 'synthetic' ? synthetic(dir) : compare(dir)
