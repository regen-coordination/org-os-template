// An import into the Hub, from the command line (DAO-OS L6 spec §9.2, Tasks 12 and 13):
//
//   npm run import -- notion <folder> [--map <file>] [--html <folder>] [--apply]
//   npm run import -- fileverse <folder> [--map <file>] [--apply]
//
// On the machine holding the instance, while no Hub server runs for it (its pid file, as house:restore). For notion,
// <folder> is an unzipped Notion Markdown & CSV export (nested Part-N.zip files unzipped too); for fileverse, the
// Fileverse pull's output (docs/governance/fileverse/), read and never written to. Without --apply it writes nothing in the
// instance: it prints the report and writes a map file beside the export (<folder>/hub-import-map.yaml, never over one
// that is there, and never inside the repository: a pull's folder is in it, so there the map is printed instead, Task 13)
// for the operator to edit; with --apply it makes the one workspace commit, the store's part around it and the receipt
// (server/workspace/imports.ts). The map is --map, else the map file beside the export when there is one. A pull inside
// the repository whose dDoc the map keeps stricter than members is refused while git tracks that dDoc's files or would
// take them (SNAPSHOT_IN_GIT, Tasks 13-14 review I4): its snapshot would be at members there.
// The repository is --repo <path>, else the folder npm was run from.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'
import { isKnown, resolveActor } from '../server/actor.ts'
import { runningServer } from '../server/state.ts'
import { privateDir, STORE_FILE } from '../server/private/paths.ts'
import { openPrivateStore, type PrivateStore } from '../server/private/store.ts'
import { applyImport, planImport, type ImportMap, type ImportPlan } from '../server/workspace/imports.ts'
import { MAP_FILE, readNotionExport } from '../lib/imports/notion.mjs'
import { readFileverse } from '../lib/imports/fileverse.mjs'
import type { ImportBundle } from '../lib/imports/bundle.mjs'

export interface Io { repo: string; out: (text: string) => void; err: (text: string) => void; env?: NodeJS.ProcessEnv }

const USAGE = 'Use: npm run import -- <notion|fileverse> <folder> [--map <file>] [--html <folder>, notion only] [--apply]'
export const SERVER_RUNS = 'Stop the server for this repository first.'
export const NOTHING_WRITTEN = 'Nothing was written in the instance.'
/** A pull inside the repository whose dDoc kept stricter than members is in git, or would be (Tasks 13–14 review I4):
 *  the import would keep the Hub's copy private while the snapshot's text is in git at members. */
export const SNAPSHOT_IN_GIT = (docs: string[]): string => {
  const one = docs.length === 1
  return `${docs.join(', ')} ${one ? 'is' : 'are'} kept stricter than members, and ${one ? 'its' : 'their'} snapshot is in git here (tracked, or not ignored), where every member reads it: pull ${one ? 'it' : 'them'} into a folder git ignores and import ${one ? 'it' : 'them'} from there. Nothing was written.`
}

/** The map file a dry run writes: every database with where it would go, its level and its fields' types; the pages'
 *  level; every name seen in a people field, linked to no member until the operator says; authorship not kept. */
function mapFor(bundle: ImportBundle, plan: ImportPlan): string {
  if (bundle.source === 'fileverse') return fileverseMapFor(bundle)
  const counts = new Map<string, number>()
  for (const c of bundle.collections) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
  const databases: Record<string, unknown> = {}
  // `within`: the page, row or database a nested database sits in (it takes that level; the map may only make it stricter).
  for (const d of plan.databases) databases[counts.get(d.name) === 1 ? d.name : `${d.name} ${d.sid}`] = { into: d.into, level: d.level, fields: d.fields, ...(d.within ? { within: d.within } : {}) }
  const people: Record<string, string> = {}
  for (const c of bundle.collections) {
    for (const f of c.fields.filter(x => x.type === 'person')) {
      for (const r of c.rows) for (const n of [r.values[f.id]].flat()) if (typeof n === 'string' && n !== '') people[n] = ''
    }
  }
  const head = [
    '# The map for importing this export into the Hub (DAO-OS L6 §9.2). Edit it, then run the import again with --apply.',
    '# level: members (the default) or stricter (hat:<hat ref>, role:<role id>); public is refused. A stricter database',
    '# lands in the private store; a database `within` a stricter item takes its level, or a stricter one. people: link a',
    '# name to a member id; an unlinked name stays text kept at defaults.contact.',
    '',
  ].join('\n')
  return `${head}${stringify({ databases, pages: { level: 'members' }, people, keep_authors: false }, { lineWidth: 0 })}`
}

/** A Fileverse pull's map: each dDoc with its level (members until the operator says, §20 Q7) and its title (the pull names
 *  a dDoc by its folder only). */
function fileverseMapFor(bundle: ImportBundle): string {
  const docs: Record<string, { level: string, title: string }> = {}
  for (const p of bundle.pages) if (p.parent === null) docs[p.sid] = { level: 'members', title: p.title }
  const head = [
    '# The map for importing this Fileverse pull into the Hub (DAO-OS L6 §9.5). Edit it, then run the import again with --apply.',
    '# docs: each dDoc by its folder; level: members (the default) or stricter (hat:<hat ref>, role:<role id>); public is',
    '# refused. A stricter dDoc lands in the private store, its tabs with it. title: the dDoc page\'s title.',
    '',
  ].join('\n')
  return `${head}${stringify({ docs }, { lineWidth: 0 })}`
}

/** Whether `path` is inside the repository at `repo` (both read through their links). */
function inside(repo: string, path: string): boolean {
  const real = (p: string) => { try { return realpathSync(p) } catch { return resolve(p) } }
  const rel = relative(real(repo), real(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The dDocs of `pages` (source ids kept stricter than members) whose files, under the pull `folder` inside `repo`, git
 *  tracks or would take (not ignored): `git ls-files --cached --others --exclude-standard` over their folders and files. */
function inGit(repo: string, folder: string, pages: readonly string[]): string[] {
  if (pages.length === 0) return []
  const root = realpathSync(repo)
  const base = realpathSync(folder)
  const specs = new Map<string, string>()
  for (const sid of pages) specs.set(relative(root, join(base, sid.includes('/') ? `${sid}.md` : sid)), sid.split('/')[0]!)
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...[...specs.keys()].map(p => `:(literal)${p}`)],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(p => p !== '')
  const docs = new Set<string>()
  for (const file of listed) for (const [spec, doc] of specs) if (file === spec || file.startsWith(`${spec}/`)) docs.add(doc)
  return [...docs].sort()
}

function said(plan: ImportPlan, bundle: ImportBundle): string[] {
  const r = plan.report
  const lines = [
    `${bundle.source === 'notion' ? 'Notion export' : 'Fileverse pull'} of ${bundle.exported}: ${r.created.collections} collections, ${r.created.records} records and ${r.created.pages} pages to create; ${r.updated} to update; ${r.kept.length} kept.`,
  ]
  for (const k of r.kept) lines.push(`  kept: ${k.what}: ${k.why}`)
  for (const n of r.notCarried) lines.push(`  not carried: ${n.what}: ${n.why}`)
  return lines
}

/** Runs the command; answers the exit code. Everything said goes through `io`. */
export async function main(argv: string[], io: Io): Promise<number> {
  const env = io.env ?? process.env
  const repo = resolve(io.repo)
  const args = [...argv]
  const flag = (name: string): string | null => {
    const at = args.indexOf(name)
    if (at < 0) return null
    const [, value] = args.splice(at, 2)
    return value ?? ''
  }
  const apply = args.includes('--apply')
  if (apply) args.splice(args.indexOf('--apply'), 1)
  const mapArg = flag('--map')
  const html = flag('--html')
  const [source, folderArg, ...rest] = args
  if ((source !== 'notion' && source !== 'fileverse') || !folderArg || rest.length > 0 || mapArg === '' || html === '' || (source === 'fileverse' && html !== null)) {
    io.err(USAGE)
    return 1
  }
  if (runningServer(repo) !== null) { io.err(SERVER_RUNS); return 1 }
  const here = env.INIT_CWD ?? process.cwd()
  const folder = resolve(here, folderArg)
  if (!existsSync(folder)) { io.err(`There is no folder ${folder}.`); return 1 }
  const mapFile = mapArg !== null ? resolve(here, mapArg) : join(folder, MAP_FILE)
  let map: ImportMap = {}
  if (existsSync(mapFile)) {
    try { map = (parse(readFileSync(mapFile, 'utf8')) ?? {}) as ImportMap } catch (err) {
      io.err(`${mapFile} is not valid YAML (${(err instanceof Error ? err.message : String(err)).split('\n')[0]}). Nothing was written.`)
      return 1
    }
  } else if (mapArg !== null) { io.err(`There is no map file ${mapFile}. Nothing was written.`); return 1 }

  const dir = privateDir(repo, env)
  let store: PrivateStore | null = null
  try {
    // A dry run reads the store only where one is there: it never makes one.
    if (apply || existsSync(join(dir, STORE_FILE))) {
      try { store = await openPrivateStore(repo, { dir }) } catch { store = null }
    }
    const bundle = source === 'fileverse' ? readFileverse(folder) : readNotionExport(folder, html !== null ? { html: resolve(here, html) } : {})
    const plan = planImport(bundle, map, repo, store)
    // A pull inside the repository: a dDoc kept stricter than members must not be in git (I4), dry run or not.
    if (source === 'fileverse' && inside(repo, folder)) {
      const open = inGit(repo, folder, plan.privatePages)
      if (open.length > 0) { io.err(SNAPSHOT_IN_GIT(open)); return 1 }
    }
    for (const line of said(plan, bundle)) io.out(line)
    if (!apply) {
      const beside = join(folder, MAP_FILE)
      // Beside the export, unless the export is inside the repository (a Fileverse pull's folder is): a dry run writes
      // nothing in the instance, so the map is printed there instead. A link where the map would go is never followed
      // (it may point into the repository), and the file is made new or not at all (`wx`): Tasks 13-14 review M3.
      if (mapArg === null && !existsSync(beside)) {
        const printed = `The map, to save outside the repository, edit, and pass with --map <file> --apply:\n${mapFor(bundle, plan)}`
        let linked = false
        try { linked = lstatSync(beside).isSymbolicLink() } catch { /* nothing there */ }
        if (linked) io.out(`${beside} is a link, which the import does not follow. ${printed}`)
        else if (inside(repo, folder)) io.out(printed)
        else {
          try { writeFileSync(beside, mapFor(bundle, plan), { flag: 'wx' }); io.out(`The map is at ${beside}: edit it, then run again with --apply.`) } catch { io.out(printed) }
        }
      }
      io.out(NOTHING_WRITTEN)
      return 0
    }
    const actor = await resolveActor(repo)
    if (!isKnown(actor)) { io.err('Read-only: no member matches this git identity. Nothing was written.'); return 1 }
    const out = await applyImport(repo, plan, actor, store)
    io.out(out.commit === null ? 'Nothing changed: the instance already holds this export as imported.' : `Imported in commit ${out.commit}.`)
    return 0
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err))
    return 1
  } finally { store?.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--repo')
  const repo = at >= 0 && args[at + 1] ? args.splice(at, 2)[1]! : process.env.INIT_CWD ?? process.cwd()
  process.exitCode = await main(args, { repo, out: t => console.log(t), err: t => console.error(t) })
}
