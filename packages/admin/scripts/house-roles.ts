// The Roles, from the command line (Lane 3 Task 3, I4):
//
//   <a Roles document on stdin> | npm run -s house:roles -- load
//
// Reads an I4 Roles document as JSON on stdin — never a file path, so no Roles file need ever exist on disk — checks it
// against schemas/roles-doc.schema.json, and replaces the Roles in the private store with it, whole. It says counts
// only: never a name, an id or a key. The store is the one the server opens: hosted (ORG_OS_HOSTED), the hosted
// configuration's ORG_OS_PRIVATE_DIR; otherwise ORG_OS_PRIVATE_DIR or <repo>/.org-os/private. The repository is
// --repo <path>, else the folder npm was run from.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import { readHostedConfig } from '../server/hosted/config.ts'
import { privateDir } from '../server/private/paths.ts'
import { openPrivateStore, rolesDocRefusal, type RolesDoc } from '../server/private/store.ts'
import { readHosted } from '../server/serve.ts'

export interface Io {
  repo: string
  /** The whole of stdin, as text. Asked only once the arguments are good. */
  stdin: () => Promise<string>
  out: (text: string) => void
  err: (text: string) => void
  env?: Record<string, string | undefined>
}

/** stdin is refused past this: a Roles document for any org is far smaller. */
const MAX_BYTES = 8 * 1024 * 1024

const SCHEMA = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/roles-doc.schema.json', import.meta.url)), 'utf8')) as object
const validate = new Ajv({ allErrors: false, strict: false }).compile<RolesDoc>(SCHEMA)

const USAGE = 'Use: <a Roles document> | npm run -s house:roles -- load. The document is read on stdin only, never from a file.'
const NOT_JSON = 'The Roles document on stdin is not JSON; nothing was loaded.'
const ADDRESS = 'A Roles document must hold no address (a string with @); nothing was loaded.'

/** The counts line: `roles <version>: N people, N steward, N node-lead, N network-member`. */
export function countsLine(doc: RolesDoc): string {
  const holding = (role: string) => doc.people.filter(p => (p.roles as string[]).includes(role)).length
  return `roles ${doc.roles_version}: ${doc.people.length} people, ${holding('steward')} steward, ${holding('node-lead')} node-lead, ${holding('network-member')} network-member`
}

/** The store's folder, as the server would open it. */
function storeDir(repo: string, env: Record<string, string | undefined>): string | { refuse: string } {
  if (!readHosted([], env)) return privateDir(repo, env as NodeJS.ProcessEnv)
  const read = readHostedConfig(env, repo)
  return 'refuse' in read ? read : read.config.privateDir
}

/** Runs one verb; answers the exit code. Everything said goes through `io`, and none of it repeats the document. */
export async function main(argv: string[], io: Io): Promise<number> {
  if (argv.length !== 1 || argv[0] !== 'load') { io.err(USAGE); return 1 }
  const env = io.env ?? process.env
  const repo = resolve(io.repo)
  try {
    const text = await io.stdin()
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) { io.err('The Roles document on stdin is larger than 8 MB; nothing was loaded.'); return 1 }
    let doc: unknown
    try { doc = JSON.parse(text) } catch { io.err(NOT_JSON); return 1 }
    if (text.includes('@')) { io.err(ADDRESS); return 1 }
    if (!validate(doc)) {
      const e = validate.errors?.[0]
      io.err(`The Roles document does not match its schema at ${e?.instancePath || '/'} (${e?.message ?? 'not valid'}); nothing was loaded.`)
      return 1
    }
    const refusal = rolesDocRefusal(doc)
    if (refusal !== null) { io.err(refusal); return 1 }
    const dir = storeDir(repo, env)
    if (typeof dir !== 'string') { io.err(dir.refuse); return 1 }
    const store = await openPrivateStore(repo, { dir })
    try { await store.replaceRoles(doc) } finally { store.close() }
    io.out(countsLine(doc))
    return 0
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err))
    return 1
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--repo')
  const repo = at >= 0 && args[at + 1] ? args.splice(at, 2)[1]! : process.env.INIT_CWD ?? process.cwd()
  process.exitCode = await main(args, { repo, stdin: readStdin, out: t => console.log(t), err: t => console.error(t) })
}
