import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keyModeRefusal, nodeRefusal, readHostedConfig } from './hosted/config.ts'
import { readHosted, startServer } from './serve.ts'
import { publicKeyRefusal } from './private/crypto.ts'

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

// Start checks that hold in every mode: the Node floor first (carry 4).
const tooOld = nodeRefusal(process.versions.node)
if (tooOld) { console.error(tooOld); process.exit(2) }

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
let hostedConfig
if (hosted) {
  const read = readHostedConfig(process.env, repo)
  if ('refuse' in read) { console.error(read.refuse); process.exit(2) }
  for (const w of read.warnings) console.warn(w)
  hostedConfig = read.config
  if (hostedConfig.deployKeyFile && existsSync(hostedConfig.deployKeyFile)) {
    const bad = keyModeRefusal(hostedConfig.deployKeyFile, statSync)
    if (bad) { console.error(bad); process.exit(2) }
  }
  // A backup public key that is not one stops the start (§5.1, moved here from Task 1); one not mounted is attention.
  if (hostedConfig.backupPublicKeyFile && existsSync(hostedConfig.backupPublicKeyFile)) {
    const bad = publicKeyRefusal(hostedConfig.backupPublicKeyFile)
    if (bad) { console.error(bad); process.exit(2) }
  }
}
const running = await startServer({ repo, port: hostedConfig && !process.argv.includes('--port') ? hostedConfig.port : port, appDist, hosted, hostedConfig })
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
