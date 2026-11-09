// "Map the rest" (network N1): pasted lines become Systems, a GitHub owner's repos become repo Systems, and the old
// repos.manifest.json is offered as repo Systems. Pure: the page runs it in the browser, so no node: imports. It does
// not import federation/peers.mjs (that pulls in node readers); `repoAddress`/`sameRepo` below apply the same github
// and url rules as peers.mjs's addressOf/sameAddress, for the forms a repo System's url takes.

const CHAINS = { eth: 'eip155:1', oeth: 'eip155:10', gno: 'eip155:100', matic: 'eip155:137', arb1: 'eip155:42161', base: 'eip155:8453', celo: 'eip155:42220', sep: 'eip155:11155111' }
const HEX = '0x[0-9a-fA-F]{40}'
const SAFE_RE = new RegExp(`^(${Object.keys(CHAINS).join('|')}):(${HEX})$`)

const NOT_KNOWN = 'Not a link this page knows. Paste a web address, a GitHub repo or organization, or a Safe as chain:0x….'

/** The address a repo url names, as peers.mjs reads it: { kind: 'github', owner, repo } or { kind: 'url', href }. */
function repoAddress(ref) {
  const r = String(ref ?? '').trim()
  if (!r) return null
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)\/?$/i.exec(r)
  if (ssh) return { kind: 'github', owner: ssh[1], repo: ssh[2].replace(/\.git$/i, '') }
  const web = /^(?:https?:\/\/(?:[^/?#@]*@)?)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/?([^?#]*)$/i.exec(r)
  if (web) return { kind: 'github', owner: web[1], repo: web[2].replace(/\.git$/i, '') }
  if (/^https?:\/\//i.test(r)) {
    try {
      const u = new URL(r)
      return { kind: 'url', href: `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '').replace(/\.git$/i, '') }
    } catch { return null }
  }
  return null
}
function sameRepo(a, b) {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'github') return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  return a.href === b.href
}

const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`
const safe = (prefix, address) => ({ kind: 'safe', name: `Safe ${short(address)}`, chain: CHAINS[prefix], address })

function pageKind(u, line) {
  const host = u.hostname.replace(/^www\./, '')
  const seg = u.pathname.split('/').filter(Boolean)[0] ?? ''
  const named = product => ({ name: seg ? `${product} ${decodeURIComponent(seg)}` : product, url: line })
  if (host === 'notion.so' || host.endsWith('.notion.so')) return { kind: 'docs', ...named('Notion') }
  if (host === 'notion.site' || host.endsWith('.notion.site')) return { kind: 'docs', ...named('Notion') }
  if (host === 'docs.google.com') {
    if (u.pathname.startsWith('/document')) return { kind: 'docs', ...named('Google Docs') }
    if (u.pathname.startsWith('/spreadsheets')) return { kind: 'database', ...named('Google Sheets') }
  }
  if (host === 'drive.google.com') return { kind: 'docs', ...named('Google Drive') }
  if (host === 'airtable.com' || host.endsWith('.airtable.com')) return { kind: 'database', ...named('Airtable') }
  return { kind: 'link', name: u.hostname, url: line }
}

/** One pasted line: null for a blank or `#` line; else { ok: true, system } | { ok: true, githubOwner } | { ok: false, line, error }. */
export function recogniseLink(input) {
  const line = String(input ?? '').trim()
  if (!line || line.startsWith('#')) return null
  const bad = error => ({ ok: false, line, error })

  const repo = /^https:\/\/(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(line)
  if (repo) return { ok: true, system: { kind: 'repo', name: repo[2], url: `https://github.com/${repo[1]}/${repo[2]}` } }
  // The ssh forms of a repo (git clone addresses) name the same repo; the system's url is the https one.
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/i.exec(line)
  if (ssh) return { ok: true, system: { kind: 'repo', name: ssh[2], url: `https://github.com/${ssh[1]}/${ssh[2]}` } }
  const owner = /^https:\/\/(?:www\.)?github\.com\/([^/?#\s]+)\/?$/i.exec(line)
  if (owner) return { ok: true, githubOwner: owner[1] }

  const snap = /^https:\/\/snapshot\.box\/#\/s:([^/?#\s]+)/.exec(line) ?? /^https:\/\/snapshot\.org\/#\/([^/?#\s]+)/.exec(line)
  if (snap) return { ok: true, system: { kind: 'snapshot-space', name: snap[1], space: snap[1] } }

  const plain = SAFE_RE.exec(line)
  if (plain) return { ok: true, system: safe(plain[1], plain[2]) }
  if (/^https:\/\/app\.safe\.global\//i.test(line)) {
    const m = new RegExp(`[?&]safe=(${Object.keys(CHAINS).join('|')}):(${HEX})`).exec(line)
    if (m) return { ok: true, system: safe(m[1], m[2]) }
  }
  if (new RegExp(`^${HEX}$`).test(line)) return bad('Say which chain, like celo:0x… or eth:0x….')

  if (/^http:\/\//i.test(line)) return bad('Use the https address.')
  if (/^https:\/\//i.test(line)) {
    let u
    try { u = new URL(line) } catch { return bad(NOT_KNOWN) }
    return { ok: true, system: pageKind(u, line) }
  }
  return bad(NOT_KNOWN)
}

/** A lower-case slug of `name`, with -2, -3… when it is in `taken`. */
export function systemIdFor(name, taken) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** The id of the first of `list` that is the same thing as `s`, else null. */
function duplicateIn(s, list) {
  for (const o of list) {
    if (o.kind !== s.kind) continue
    if (s.kind === 'repo') { if (o.url && sameRepo(repoAddress(o.url), repoAddress(s.url))) return o.id }
    else if (s.kind === 'safe') { if (o.chain === s.chain && String(o.address ?? '').toLowerCase() === s.address.toLowerCase()) return o.id }
    else if (s.kind === 'snapshot-space') { if (o.space === s.space) return o.id }
    else if (o.url && o.url === s.url) return o.id
  }
  return null
}

/** Pasted text: { rows, owners, errors }. A repeat of an existing System, or of an earlier row, carries that id in duplicateOf. */
export function recogniseLines(text, existing) {
  const rows = []
  const owners = []
  const errors = []
  const taken = new Set(existing.map(s => s.id))
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const r = recogniseLink(raw)
    if (!r) continue
    if (!r.ok) { errors.push({ line: r.line, error: r.error }); continue }
    if ('githubOwner' in r) { if (!owners.includes(r.githubOwner)) owners.push(r.githubOwner); continue }
    const duplicateOf = duplicateIn(r.system, [...existing, ...rows.map(x => x.system)])
    const id = systemIdFor(r.system.name, taken)
    taken.add(id)
    rows.push({ line: raw.trim(), system: { id, ...r.system }, duplicateOf })
  }
  return { rows, owners, errors }
}

/** A GitHub owner's repos as repo Systems; archived -> 'archive', fork -> 'fork'; ones already listed are left out. */
export function githubRepoSystems(list, existing) {
  const taken = new Set(existing.map(s => s.id))
  const out = []
  for (const r of list) {
    const s = { kind: 'repo', name: r.name, url: r.url }
    if (duplicateIn(s, [...existing, ...out])) continue
    const id = systemIdFor(r.name, taken)
    taken.add(id)
    const system = { id, ...s }
    if (r.archived) system.purpose = 'archive'
    else if (r.fork) system.purpose = 'fork'
    if (r.description) system.description = r.description
    out.push(system)
  }
  return out
}

/** Entries of the old repos.manifest.json that no repo System matches by url or mount, as repo Systems to offer. */
export function manifestImports(manifest, systems) {
  const entries = manifest && Array.isArray(manifest.repositories) ? manifest.repositories : []
  const base = manifest?.baseDirectory ?? 'repos'
  const repos = systems.filter(s => s.kind === 'repo')
  const taken = new Set(systems.map(s => s.id))
  const out = []
  for (const e of entries) {
    if (!e || !e.name || !e.url) continue
    const mount = `${base}/${e.name}`
    const addr = repoAddress(e.url)
    if (repos.some(s => s.mount === mount || (s.url && sameRepo(repoAddress(s.url), addr)))) continue
    const id = systemIdFor(e.name, taken)
    taken.add(id)
    const imp = { id, kind: 'repo', name: e.name, url: String(e.url).replace(/\.git$/i, ''), mount }
    if (e.branch && e.branch !== 'main') imp.branch = e.branch
    out.push(imp)
  }
  return out
}
