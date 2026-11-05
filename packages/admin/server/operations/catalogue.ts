import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpError } from '../errors.ts'
import { failingFileChecks } from '../resources/adapters/modules.ts'
import { idOf, list, str } from '../resources/util.ts'
import { fetchRemote, validBranchName } from '../git.ts'
import { resolveTrunk } from '../proposals/ledger.ts'
import { validTrunkName } from '../../lib/rules.mjs'
import type { Kind, Resource } from '../resources/types.ts'

/** A command the executor spawns (never through a shell), and the repository paths it may change. */
export interface Planned { cmd: string; args: string[]; writes: string[] }
/** Work done inside the server process: it changes no file, and answers the text for the job's log. `summary` is what a
 *  confirmation shows, for one that reaches the network (the `fetch` operation). */
export interface InProcess { inProcess: (repo: string, signal: AbortSignal) => Promise<string>; summary?: string }
export interface Variant { label: string; params: Record<string, unknown>; unavailable: string | null }

export interface ParamsSchema {
  type: 'object'; additionalProperties: false
  properties?: Record<string, Record<string, unknown>>; required?: string[]
}

export interface Operation {
  id: string
  kinds: Kind[]
  label: (r: Resource) => string
  effect: 'reads' | 'changes'
  network: boolean
  timeoutMs: number
  params: ParamsSchema
  /** One action per variant (a module's command checks); the UI sends the variant's params. */
  variants?: (r: Resource) => Variant[]
  /** null when the operation can run on this resource; otherwise the sentence saying why not. */
  unavailable: (r: Resource, repo: string) => string | null
  /** `ctx.startBranch` is the branch the server started on (the trunk when governance names none). A plan may be async. */
  plan: (r: Resource, params: Record<string, unknown>, repo: string, ctx?: { startBranch?: string }) => Planned | InProcess | Promise<Planned | InProcess>
  /** The adapter to read again when a job ends, because what it shows may have changed. */
  refreshes: 'records' | 'modules' | 'crew' | 'fleet' | 'sources'
}

/** The server asks for a confirmation (a planned nonce) before anything that changes a file or
 *  a running agent, and before anything that reaches the network. */
export const needsConfirm = (op: Pick<Operation, 'effect' | 'network'>): boolean => op.effect === 'changes' || op.network

const NO_PARAMS: ParamsSchema = { type: 'object', additionalProperties: false }
const SEC = 1000

const crewScript = (repo: string) => join(repo, 'scripts', 'crew.mjs')
const noCrew = (repo: string) => (existsSync(crewScript(repo)) ? null : "crew isn't installed here (no scripts/crew.mjs)")
const doctorScript = (r: Resource) => `${idOf(r.id).replace(/^org-os-/, '')}:doctor`
const npmScripts = (repo: string): Record<string, unknown> => {
  try { return (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }).scripts ?? {} }
  catch { return {} }
}
const kmsCli = (repo: string) => join(repo, 'packages', 'org-os-kms', 'src', 'cli.mjs')

/** Characters that mean something only to a shell. The platform runs commands without one, so
 *  a check that needs them would not do what its author meant; it is left to a terminal. */
const SHELL = /[|&;<>()$`\\"'*?~{}[\]#\n]/

/** Operations the spec leaves out of the platform (§5.1, §3.15: stash, clean, reset and force; push exists only as the share operation). A command
 *  check naming one is refused even when it has no shell character, because it would run anyway. */
const RULED_OUT = ['stash', 'clean', 'reset', 'clean-worktrees', '--force', '--force-with-lease', '-f', '--hard', '--yes', '-D', 'push', '--mirror', '--delete']

export function commandArgv(text: string): { cmd: string; args: string[] } | string {
  if (SHELL.test(text)) return `"${text}" holds a shell character; the platform runs commands without a shell, so run this check in a terminal`
  const [cmd, ...args] = text.trim().split(/\s+/)
  const ruled = [cmd, ...args].find(t => RULED_OUT.includes(t))
  if (ruled !== undefined) return `"${text}" names ${ruled}, which the platform never runs (spec §5.1: stash, clean, reset and force are left out); run it in a terminal if you mean it`
  return cmd ? { cmd, args } : 'the check names no command'
}

/** A record's id as crew may take it: a plain positional that cannot start an option and cannot
 *  climb out of crew's memory folder. Anything else is refused, never escaped. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const safeId = (id: string): string | null => (SAFE_ID.test(id) ? id : null)
const unsafeId = (id: string) => `this id cannot be passed to crew safely: "${id}"`
/** The reason a crew call cannot take this resource's id, or null. */
const idProblem = (r: Resource): string | null => (safeId(idOf(r.id)) === null ? unsafeId(idOf(r.id)) : null)
const refuse = (problem: string | null): void => { if (problem !== null) throw new HttpError(409, `Not run: ${problem}.`) }

export const CATALOGUE: Operation[] = [
  {
    id: 'module.checks', kinds: ['module'], label: () => 'Re-run checks', effect: 'reads', network: false,
    timeoutMs: 30 * SEC, params: NO_PARAMS, refreshes: 'modules',
    unavailable: r => (list(r.facts.fileChecks).length ? null : 'this module declares no file checks'),
    plan: r => ({
      inProcess: async repo => list(r.facts.fileChecks).map(p => {
        const [fails] = failingFileChecks(repo, [p])
        return fails ? `✗ ${fails}\n` : `✓ ${p}\n`
      }).join(''),
    }),
  },
  {
    id: 'module.command-check', kinds: ['module'], label: () => 'Run check', effect: 'changes', network: true,
    timeoutMs: 300 * SEC, refreshes: 'modules',
    params: { type: 'object', additionalProperties: false, required: ['index'], properties: { index: { type: 'integer', minimum: 0 } } },
    variants: r => list(r.facts.commandChecks).map((text, index) => {
      const argv = commandArgv(text)
      return { label: `Run check: ${text}`, params: { index }, unavailable: typeof argv === 'string' ? argv : null }
    }),
    unavailable: r => (list(r.facts.commandChecks).length ? null : 'this module declares no command checks'),
    plan: (r, p) => {
      const text = list(r.facts.commandChecks)[Number(p.index)]
      if (text === undefined) throw new HttpError(422, `This module has no command check number ${String(p.index)}.`)
      const argv = commandArgv(text)
      if (typeof argv === 'string') throw new HttpError(409, `Not run: ${argv}.`)
      return { ...argv, writes: [] }
    },
  },
  {
    id: 'module.doctor', kinds: ['module'], label: () => 'Run doctor', effect: 'reads', network: true,
    timeoutMs: 120 * SEC, params: NO_PARAMS, refreshes: 'modules',
    unavailable: (r, repo) => (npmScripts(repo)[doctorScript(r)] ? null : `no "${doctorScript(r)}" script in package.json`),
    plan: r => ({ cmd: 'npm', args: ['run', doctorScript(r)], writes: [] }),
  },
  {
    id: 'seat.report', kinds: ['seat'], label: () => 'Read latest report', effect: 'reads', network: false,
    timeoutMs: 10 * SEC, params: NO_PARAMS, refreshes: 'crew',
    unavailable: (r, repo) => idProblem(r) ?? (existsSync(join(repo, 'memory', 'crew', `${idOf(r.id)}.md`)) ? null : 'this seat has no record file'),
    plan: r => {
      refuse(idProblem(r))
      return {
        inProcess: async repo => {
          const text = readFileSync(join(repo, 'memory', 'crew', `${idOf(r.id)}.md`), 'utf8')
          return text.length > 65_536 ? `…\n${text.slice(-65_536)}` : text
        },
      }
    },
  },
  {
    id: 'seat.read-pane', kinds: ['seat'], label: () => 'Read pane', effect: 'reads', network: false,
    timeoutMs: 10 * SEC, params: NO_PARAMS, refreshes: 'crew',
    unavailable: r => (!str(r.facts.pane) ? 'this seat records no herdr pane' : r.facts.state === null ? 'the seat has no live agent' : null),
    plan: r => ({ cmd: 'herdr', args: ['pane', 'read', String(r.facts.pane), '--source', 'recent', '--lines', '80', '--format', 'text'], writes: [] }),
  },
  {
    id: 'seat.focus', kinds: ['seat'], label: () => 'Focus in herdr', effect: 'reads', network: false,
    timeoutMs: 10 * SEC, params: NO_PARAMS, refreshes: 'crew',
    unavailable: r => (str(r.facts.workspace) ? null : 'this seat records no herdr workspace'),
    plan: r => ({ cmd: 'herdr', args: ['workspace', 'focus', String(r.facts.workspace)], writes: [] }),
  },
  {
    id: 'seat.nudge', kinds: ['seat'], label: () => 'Nudge', effect: 'changes', network: false,
    timeoutMs: 60 * SEC, params: NO_PARAMS, refreshes: 'crew',
    unavailable: (r, repo) => idProblem(r) ?? noCrew(repo) ?? (r.facts.state === null ? 'the seat has no live agent' : null),
    plan: (r, _p, repo) => {
      refuse(idProblem(r))
      return { cmd: process.execPath, args: [crewScript(repo), 'nudge', idOf(r.id)], writes: ['memory/crew/'] }
    },
  },
  {
    id: 'seat.release', kinds: ['seat'], label: () => 'Release', effect: 'changes', network: false,
    timeoutMs: 120 * SEC, refreshes: 'crew',
    params: { type: 'object', additionalProperties: false, required: ['outcome'], properties: { outcome: { enum: ['done', 'abandoned'] } } },
    unavailable: (r, repo) => idProblem(r) ?? noCrew(repo),
    plan: (r, p, repo) => {
      refuse(idProblem(r))
      return { cmd: process.execPath, args: [crewScript(repo), 'release', idOf(r.id), '--outcome', String(p.outcome)], writes: ['memory/crew/'] }
    },
  },
  {
    id: 'role.seat', kinds: ['role'], label: r => `Seat ${idOf(r.id)}`, effect: 'changes', network: false,
    timeoutMs: 120 * SEC, refreshes: 'crew',
    params: {
      type: 'object', additionalProperties: false, required: ['brief', 'title'],
      properties: {
        brief: { type: 'string', minLength: 1, maxLength: 4000 },
        title: { type: 'string', minLength: 1, maxLength: 24 },
        task: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
        base: { type: 'string', pattern: '^[A-Za-z0-9._][A-Za-z0-9._/-]*$' },
      },
    },
    unavailable: (r, repo) => idProblem(r) ?? noCrew(repo),
    // The brief goes last, after `--`, so a brief that starts with a dash is never read as a flag.
    plan: (r, p, repo) => {
      refuse(idProblem(r))
      return {
        cmd: process.execPath,
        args: [crewScript(repo), 'seat', idOf(r.id), '--title', String(p.title),
          ...(p.task ? ['--task', String(p.task)] : []), ...(p.base ? ['--base', String(p.base)] : []), '--', String(p.brief)],
        writes: ['memory/crew/'],
      }
    },
  },
  {
    id: 'instance.assess', kinds: ['instance'], label: () => 'Assess', effect: 'reads', network: false,
    timeoutMs: 180 * SEC, params: NO_PARAMS, refreshes: 'fleet',
    unavailable: (r, repo) => !existsSync(join(repo, 'scripts', 'doctor.mjs')) ? 'instance-doctor is not here (no scripts/doctor.mjs)'
      : !str(r.facts.localPath) ? 'no clone of this instance on this machine' : null,
    plan: (r, _p, repo) => ({ cmd: process.execPath, args: [join(repo, 'scripts', 'doctor.mjs'), 'assess', '--dir', String(r.facts.localPath)], writes: [] }),
  },
  {
    id: 'instance.analyze', kinds: ['instance'], label: () => 'Re-analyze fleet', effect: 'changes', network: false,
    timeoutMs: 300 * SEC, params: NO_PARAMS, refreshes: 'fleet',
    unavailable: (r, repo) => r.facts.self !== true ? "offered on this instance's own card"
      : !existsSync(join(repo, 'scripts', 'analyze-instances.mjs')) ? 'no scripts/analyze-instances.mjs here'
      : !existsSync(join(repo, 'data', 'instances.yaml')) ? 'no data/instances.yaml to analyze' : null,
    plan: (_r, _p, repo) => ({ cmd: process.execPath, args: [join(repo, 'scripts', 'analyze-instances.mjs')], writes: ['memory/reports/'] }),
  },
  {
    // The one network read of the proposal loop (0.6 P2 spec §3.12, P2-R31): `git fetch origin`, through git.ts's guard. It
    // writes only the remote-tracking refs and FETCH_HEAD, so it declares no writes and moves no HEAD. Sync starts with it.
    id: 'fetch', kinds: ['instance'], label: () => 'Fetch', effect: 'reads', network: true,
    timeoutMs: 120 * SEC, params: NO_PARAMS, refreshes: 'fleet',
    unavailable: r => (r.facts.self === true ? null : "offered on this instance's own card"),
    plan: () => ({
      summary: 'fetch origin: it downloads, it changes no file',
      inProcess: async repo => { await fetchRemote(repo, 'origin'); return 'Fetched origin.\n' },
    }),
  },
  {
    // Share (0.6 P2 spec §3.10, P2-R18, R28, R31): push the trunk to origin, never forced. The refspec is built here from
    // the trunk, which is checked first: there is no argument to carry a `+`, a second ref, a flag or another remote. An
    // explicit refspec on the command line overrides a configured `remote.origin.push`. The executor runs it like any
    // command; it moves no HEAD and writes no file, so it declares no writes.
    id: 'share', kinds: ['instance'], label: () => 'Share', effect: 'changes', network: true,
    timeoutMs: 120 * SEC, params: NO_PARAMS, refreshes: 'fleet',
    unavailable: r => (r.facts.self === true ? null : "offered on this instance's own card"),
    plan: async (_r, _p, repo, ctx) => {
      const trunk = await resolveTrunk(repo, ctx?.startBranch)
      const named = validTrunkName(trunk)
      if (named !== true) throw new HttpError(409, `Not shared: "${trunk}" cannot be the trunk: ${named} Name another in data/governance.yaml (governance.trunk). Nothing was pushed.`)
      if (!(await validBranchName(repo, trunk))) throw new HttpError(409, `Not shared: git does not accept "${trunk}" as a branch name, so it cannot be the trunk. Nothing was pushed.`)
      return { cmd: 'git', args: ['push', '--', 'origin', `refs/heads/${trunk}:refs/heads/${trunk}`], writes: [] }
    },
  },
  {
    id: 'connector.ingest', kinds: ['connector'], label: () => 'Ingest', effect: 'changes', network: true,
    timeoutMs: 600 * SEC, params: NO_PARAMS, refreshes: 'sources',
    unavailable: (_r, repo) => (existsSync(kmsCli(repo)) ? null : 'the KMS is not here (no packages/org-os-kms/src/cli.mjs)'),
    plan: (r, _p, repo) => {
      const target = str(r.facts.target) ?? '.'
      const store = target.replace(/\/+$/, '')
      return {
        cmd: process.execPath, args: [kmsCli(repo), 'ingest', '--connector', idOf(r.id), '--dir', repo],
        writes: store === '.' || store === '' ? ['.'] : [`${store}/`, 'data/kms-cursors.json'],
      }
    },
  },
]

export const opById = (id: string): Operation | undefined => CATALOGUE.find(o => o.id === id)
