import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readHosted, startServer } from './serve.ts'

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

const repo = resolve(arg('--repo', process.env.INIT_CWD ?? process.cwd()))
const port = Number(arg('--port', '4680'))

if (!existsSync(resolve(repo, 'data')) || !existsSync(resolve(repo, 'federation.yaml'))) {
  console.error(`Not an org-os instance (need data/ and federation.yaml): ${repo}`)
  process.exit(1)
}

const appDist = fileURLToPath(new URL('../app/dist', import.meta.url))
if (!existsSync(appDist)) {
  console.warn('app/dist missing — run `npm run build` for the UI (API still available)')
}

const hosted = readHosted(process.argv, process.env)
const running = await startServer({ repo, port, appDist, hosted })
console.log(`org-os admin → http://localhost:${running.port}  (repo: ${repo}${hosted ? ', hosted' : ''})`)

// Ending the server ends its jobs first (close does it). A second signal while that waits
// is the operator insisting: leave at once.
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
    console.error('org-os admin: stopping (ending running jobs)…')
    running.close().then(() => process.exit(0), () => process.exit(1))
  })
}
