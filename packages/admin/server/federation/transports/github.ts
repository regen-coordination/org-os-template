// The github transport (network N2 Task 6): a join request is an issue on the hub's repo, sent through the operator's
// own `gh`. Nothing here talks to GitHub except by running `gh`; the body goes by --body-file, never on the command line.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestText } from '../../../lib/federation/request.mjs'
import type { FederationRequest } from '../../../lib/federation/request.mjs'
import type { Incoming, Status, Transport, TransportCtx } from './types.ts'

const NOT_GITHUB = "This hub doesn't take requests on GitHub."
const INVITED = 'An invited request goes as a file, so the invite stays private.'
const TIMEOUT = 60_000

/** `owner/repo` from the hub's `join.where`, or null when it isn't `https://github.com/<o>/<r>`. */
function repoOf(where: string | null): string | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(where ?? '')
  return m ? `${m[1]}/${m[2]}` : null
}

const gh = (ctx: TransportCtx, args: string[]) => ctx.run('gh', args, { cwd: ctx.repo, timeoutMs: TIMEOUT })
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** A fence longer than any run of backticks in the text, so the text can't close the block early. */
function fenceFor(yaml: string): string {
  const longest = Math.max(0, ...(yaml.match(/`+/g) ?? []).map(r => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The yaml in the first fenced `yaml` block of an issue body, or null. */
function yamlOf(body: string): string | null {
  const m = /^(`{3,})yaml[ \t]*\n([\s\S]*?)\n\1[ \t]*$/m.exec(body.replace(/\r\n/g, '\n'))
  return m ? m[2] + '\n' : null
}

export const githubTransport: Transport = {
  id: 'github',
  label: 'Send as a GitHub issue',
  unavailable(where, request) {
    if (repoOf(where) === null) return NOT_GITHUB
    if (request?.invite) return INVITED
    return null
  },
  async ready(ctx) {
    if ((await gh(ctx, ['--version'])).code !== 0) return 'Install the GitHub CLI (gh) to send this way, or send it as a file.'
    if ((await gh(ctx, ['auth', 'status'])).code !== 0) return 'Sign in to gh first: gh auth login.'
    return null
  },
  async send(request: FederationRequest, where, ctx) {
    // Checked again here: the invite must never reach a public issue, whatever the caller did first (R18).
    const no = githubTransport.unavailable(where, request)
    if (no) throw new Error(no)
    const repo = repoOf(where)!
    const yaml = requestText(request)
    const fence = fenceFor(yaml)
    const body = `Join request from ${oneLine(request.from.name)} for ${oneLine(request.network)}.\n\n${fence}yaml\n${yaml}${fence}\n`
    const dir = mkdtempSync(join(tmpdir(), 'org-os-gh-'))
    try {
      const file = join(dir, 'body.md')
      writeFileSync(file, body)
      const title = `org-os join request: ${oneLine(request.from.name)} → ${oneLine(request.network)}`
      const r = await gh(ctx, ['issue', 'create', '--repo', repo, '--title', title, '--body-file', file])
      const url = r.stdout.trim().split('\n').pop()?.trim() ?? ''
      if (r.code !== 0 || url === '') throw new Error(`GitHub didn't take the request${r.stderr ? `: ${oneLine(r.stderr)}` : '.'}`)
      return { ref: url, summary: `Sent as an issue: ${url}` }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  },
  async poll(where, ctx): Promise<Incoming[]> {
    const repo = repoOf(where)
    if (!repo) throw new Error(NOT_GITHUB)
    const r = await gh(ctx, ['issue', 'list', '--repo', repo, '--state', 'open', '--search', 'org-os join request in:title', '--json', 'url,body', '--limit', '50'])
    if (r.code !== 0) throw new Error(`Couldn't list the issues${r.stderr ? `: ${oneLine(r.stderr)}` : '.'}`)
    let rows: unknown
    try { rows = JSON.parse(r.stdout) } catch { throw new Error("GitHub's answer couldn't be read.") }
    const out: Incoming[] = []
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.url !== 'string' || typeof row?.body !== 'string') continue
      const text = yamlOf(row.body)
      if (text !== null) out.push({ ref: row.url, text })
    }
    return out
  },
  async status(ref, ctx): Promise<Status> {
    const r = await gh(ctx, ['issue', 'view', ref, '--json', 'state,comments'])
    if (r.code !== 0) throw new Error(`Couldn't read the issue${r.stderr ? `: ${oneLine(r.stderr)}` : '.'}`)
    let doc: { state?: string; comments?: { body?: string }[] }
    try { doc = JSON.parse(r.stdout) } catch { throw new Error("GitHub's answer couldn't be read.") }
    if (doc.state !== 'CLOSED') return { state: 'waiting' }
    const last = (doc.comments ?? []).at(-1)?.body ?? ''
    const first = last.split('\n')[0].trim()
    if (first.startsWith('Accepted')) return { state: 'accepted', reason: first }
    if (first.startsWith('Refused')) return { state: 'refused', reason: first }
    return { state: 'waiting' }
  },
  async reply(ref, outcome, ctx) {
    const word = outcome.kind === 'accepted' ? 'Accepted' : 'Refused'
    const r = await gh(ctx, ['issue', 'close', ref, '--comment', `${word}: ${oneLine(outcome.sentence)}`])
    if (r.code !== 0) throw new Error(`Couldn't answer the issue${r.stderr ? `: ${oneLine(r.stderr)}` : '.'}`)
  },
}
