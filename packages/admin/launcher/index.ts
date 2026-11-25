import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { networkFetch } from '../server/net.ts'
import { readHosted, startLauncher, HOSTED_SENTENCE } from './serve.ts'

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

if (readHosted(process.argv, process.env)) {
  console.error(HOSTED_SENTENCE)
  process.exit(1)
}

const port = Number(arg('--port', '4679'))
const frameworkDir = fileURLToPath(new URL('../../..', import.meta.url))
const appDist = fileURLToPath(new URL('../app/dist', import.meta.url))
if (!existsSync(appDist)) console.warn('app/dist missing — run `npm run build` for the UI (API still available)')

const running = await startLauncher({ port, frameworkDir, appDist, fetch: networkFetch })
console.log(`org-os → http://localhost:${running.port}/launch`)

// Closing stops the admins it started. A second signal is the operator insisting: leave at once.
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
    console.error('org-os: stopping (closing the instances it opened)…')
    running.close().then(() => process.exit(0), () => process.exit(1))
  })
}
