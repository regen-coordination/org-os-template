// The tray in every tab refreshes on one message, sent after every write to a change.
import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo } from './fixtures.ts'
import { startServer } from '../../server/serve.ts'

describe('the changes event', () => {
  it('a staged op reaches every open socket as {type: "changes"}', async () => {
    const repo = makeChangeRepo()
    const server = await startServer({ repo, port: 0 })
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`)
      await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
      const got = new Promise<unknown>(resolve => ws.on('message', data => {
        const msg = JSON.parse(String(data)) as { type: string }
        if (msg.type === 'changes') resolve(msg)
      }))
      const res = await fetch(`http://127.0.0.1:${server.port}/api/changes/ops`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] }),
      })
      expect(res.status).toBe(200)
      expect(await got).toEqual({ type: 'changes' })
      ws.terminate()
    } finally {
      await server.close()
      removeFixtureRepo(repo)
    }
  })
})
