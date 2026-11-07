// The health route (L9 spec §5.11): public, and it says nothing but whether the server is serving with its private store
// open. Mounted in every mode (ruling P1); the hosted guard lets it through on the loopback for the container's own check.
import type { Hono } from 'hono'

/** GET /api/health: 200 `{ "ok": true }` while `store()` says the private store is open, else 503 `{ "ok": false }`. */
export function mountHealth(app: Hono, o: { store: () => boolean }): void {
  app.get('/api/health', c => (o.store() ? c.json({ ok: true }) : c.json({ ok: false }, 503)))
}
