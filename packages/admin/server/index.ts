import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer } from 'ws'
import type { Server } from 'node:http'
import { createApp } from './app.ts'
import { watchData } from './watcher.ts'

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

const app = createApp(repo)
const appDist = fileURLToPath(new URL('../app/dist', import.meta.url))
if (existsSync(appDist)) {
  app.use('/*', serveStatic({ root: appDist }))
  app.get('*', serveStatic({ path: 'index.html', root: appDist })) // SPA fallback
} else {
  console.warn('app/dist missing — run `npm run build` for the UI (API still available)')
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, info => {
  console.log(`org-os admin → http://localhost:${info.port}  (repo: ${repo})`)
})

const wss = new WebSocketServer({ server: server as Server, path: '/api/events' })
watchData(repo, registry => {
  const msg = JSON.stringify({ type: 'registry-changed', registry })
  for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(msg)
})
