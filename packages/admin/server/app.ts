import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { parse } from 'yaml'
import { registryDef } from './registries.ts'
import {
  listRegistries, readRegistry, updateEntity, createEntity, deleteEntity,
  type Entity,
} from './registry.ts'
import { loadSchema, validateEntity } from './schema.ts'
import { repoStatus, commitDataPaths } from './git.ts'

function orgName(repo: string): string {
  try {
    const fed = parse(readFileSync(join(repo, 'federation.yaml'), 'utf8')) as
      { identity?: { name?: string } }
    return fed.identity?.name ?? 'org'
  } catch { return 'org' }
}

/** Map thrown service errors to HTTP statuses. */
function status(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err)
  if (/unknown registry|not found|file missing/i.test(msg)) return 404
  if (/already exists/i.test(msg)) return 409
  if (/document registry/i.test(msg)) return 403
  return 500
}

/** Serialize mutating operations per registry so a read-modify-write-commit
 *  sequence can't interleave with another and silently lose an edit. Single
 *  process, so an in-memory promise chain per key is sufficient. */
function makeLock() {
  const chains = new Map<string, Promise<unknown>>()
  return function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    chains.set(key, run.catch(() => {}))
    return run
  }
}

export function createApp(repo: string): Hono {
  const app = new Hono()
  const withLock = makeLock()

  app.onError((err, c) => c.json({ error: err.message }, status(err) as 404))

  app.get('/api/status', async c => {
    const s = await repoStatus(repo)
    return c.json({ org: orgName(repo), ...s })
  })

  app.get('/api/registries', c => c.json(listRegistries(repo)))
  app.get('/api/registries/:name', c => c.json(readRegistry(repo, c.req.param('name'))))
  app.get('/api/schemas/:name', c => c.json(loadSchema(c.req.param('name'))))

  const guardCollection = (name: string) => {
    if (registryDef(name).kind !== 'collection') {
      throw new Error(`${name} is a document registry (read-only in M1)`)
    }
  }

  const validated = (c: { json: (b: unknown, s: number) => Response }, repo: string, name: string, entity: Entity) => {
    const v = validateEntity(repo, name, entity)
    return v.valid ? null : c.json({ errors: v.errors }, 422)
  }

  app.put('/api/registries/:name/:id', async c => {
    const name = c.req.param('name'); const id = c.req.param('id')
    guardCollection(name)
    const entity = (await c.req.json()) as Entity
    if (typeof entity.id === 'string' && entity.id !== id) {
      // id is immutable through this endpoint — renaming would strand inbound references.
      return c.json({ errors: [{ field: 'id', message: `id "${entity.id}" does not match the URL id "${id}"` }] }, 422)
    }
    return withLock(name, async () => {
      const invalid = validated(c as never, repo, name, entity)
      if (invalid) return invalid
      const updated = updateEntity(repo, name, id, entity)
      await commitDataPaths(repo, [`data/${name}.yaml`], `admin(${name}): update ${id}`)
      return c.json(updated)
    })
  })

  app.post('/api/registries/:name', async c => {
    const name = c.req.param('name')
    guardCollection(name)
    const entity = (await c.req.json()) as Entity
    return withLock(name, async () => {
      const invalid = validated(c as never, repo, name, entity)
      if (invalid) return invalid
      const created = createEntity(repo, name, entity)
      await commitDataPaths(repo, [`data/${name}.yaml`], `admin(${name}): create ${entity.id}`)
      return c.json(created, 201)
    })
  })

  app.delete('/api/registries/:name/:id', async c => {
    const name = c.req.param('name'); const id = c.req.param('id')
    guardCollection(name)
    return withLock(name, async () => {
      deleteEntity(repo, name, id)
      await commitDataPaths(repo, [`data/${name}.yaml`], `admin(${name}): delete ${id}`)
      return c.json({ deleted: id })
    })
  })

  return app
}
