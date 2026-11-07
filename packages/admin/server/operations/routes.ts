import type { Context, Hono } from 'hono'
import Ajv, { type ValidateFunction } from 'ajv'
import { HttpError } from '../errors.ts'
import { knownActorOf } from '../request.ts'
import type { JobStore } from '../state.ts'
import type { ResourceStore } from '../resources/index.ts'
import type { Resource } from '../resources/types.ts'
import { CATALOGUE, needsConfirm, type Operation } from './catalogue.ts'
import type { Executor } from './executor.ts'
import type { Plans } from './plans.ts'

export interface OperationDeps {
  repo: string; store: ResourceStore; jobs: JobStore; executor: Executor; plans: Plans
  catalogue?: Operation[]
  /** The branch the server started on, for routes that write the proposal ledger (`LedgerOptions.startBranch`). */
  startBranch?: string
  /** Hosted mode: no operation is offered, since a hosted Hub runs no command for anyone (L9 §5.4, Q-L9-4); the routes
   *  that would run one are refused before they are reached (hosted/writes.ts). */
  hosted?: boolean
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map<string, ValidateFunction>()

async function body(c: Context): Promise<Record<string, unknown>> {
  let v: unknown
  try { v = await c.req.json() } catch { v = undefined }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'The request body must be a JSON object.')
  return v as Record<string, unknown>
}

export function mountOperations(app: Hono, deps: OperationDeps): void {
  const catalogue = deps.catalogue ?? CATALOGUE
  const opNamed = (id: string) => {
    const op = catalogue.find(o => o.id === id)
    if (!op) throw new HttpError(404, `No operation "${id}". GET /api/operations?resource=<id> lists what a resource offers.`)
    return op
  }
  const resourceNamed = async (id: unknown): Promise<Resource> => {
    const r = typeof id === 'string' ? (await deps.store.graph()).nodes.find(n => n.id === id) : undefined
    if (!r) throw new HttpError(404, `No resource "${String(id)}".`)
    return r
  }
  const offered = (op: Operation, r: Resource) =>
    op.variants ? op.variants(r).map(v => ({ label: v.label, preset: v.params, unavailable: v.unavailable ?? op.unavailable(r, deps.repo) }))
      : [{ label: op.label(r), preset: null, unavailable: op.unavailable(r, deps.repo) }]

  /** Everything a run needs, checked: the operation applies to the resource, is available, and
   *  its params are what its schema says. Each refusal is a sentence. */
  const prepare = async (opId: string, input: Record<string, unknown>) => {
    const op = opNamed(opId)
    const resource = await resourceNamed(input.resource)
    if (!op.kinds.includes(resource.kind)) throw new HttpError(409, `"${op.id}" does not apply to a ${resource.kind}.`)
    const params = (input.params ?? {}) as Record<string, unknown>
    let validate = validators.get(op.id)
    if (!validate) { validate = ajv.compile(op.params); validators.set(op.id, validate) }
    if (!validate(params)) {
      throw Object.assign(new HttpError(422, 'invalid params'), {
        errors: (validate.errors ?? []).map(e => ({ field: e.instancePath.replace(/^\//, '') || String(e.params.missingProperty ?? ''), message: e.message ?? 'invalid' })),
      })
    }
    const why = op.unavailable(resource, deps.repo)
    if (why) throw new HttpError(409, `Not run: ${why}.`)
    return { op, resource, params, planned: await op.plan(resource, params, deps.repo, { startBranch: deps.startBranch }) }
  }

  app.get('/api/operations', async c => {
    if (deps.hosted) return c.json([])
    const id = c.req.query('resource')
    if (id !== undefined) {
      const r = await resourceNamed(id)
      return c.json(catalogue.filter(op => op.kinds.includes(r.kind)).flatMap(op => offered(op, r).map(o => ({
        id: op.id, label: o.label, effect: op.effect, network: op.network, confirm: needsConfirm(op), params: op.params, preset: o.preset, unavailable: o.unavailable,
      }))))
    }
    const nodes = (await deps.store.graph()).nodes
    return c.json(nodes.flatMap(r => catalogue.filter(op => op.kinds.includes(r.kind)).flatMap(op => offered(op, r)
      .filter(o => o.unavailable === null)
      .map(o => ({ op: op.id, label: o.label, resource: r.id, resourceName: r.name, board: r.board, confirm: needsConfirm(op), preset: o.preset })))))
  })

  app.post('/api/operations/:op/plan', async c => {
    // Planning, running and cancelling are acts: a member's only, as staging is (a stranger 403, hosted with no session
    // 401). Before anything is read or a nonce is spent. The lists stay reads.
    knownActorOf(c)
    const { op, resource, params, planned } = await prepare(c.req.param('op'), await body(c))
    if ('inProcess' in planned) {
      // In-process work that reaches the network (the fetch) is confirmed too: its nonce holds the function itself.
      const confirm = needsConfirm(op)
      const nonce = confirm
        ? deps.plans.issue({ op: op.id, resource: resource.id, params, cmd: '', args: [], writes: [], timeoutMs: op.timeoutMs, inProcess: planned.inProcess })
        : null
      return c.json({ op: op.id, resource: resource.id, inProcess: true, cmd: null, args: [], writes: [], timeoutMs: op.timeoutMs, confirm, nonce,
        ...(planned.summary !== undefined ? { summary: planned.summary } : {}) })
    }
    const confirm = needsConfirm(op)
    const nonce = confirm ? deps.plans.issue({ op: op.id, resource: resource.id, params, ...planned, timeoutMs: op.timeoutMs }) : null
    return c.json({ op: op.id, resource: resource.id, inProcess: false, ...planned, timeoutMs: op.timeoutMs, confirm, nonce })
  })

  app.post('/api/jobs', async c => {
    knownActorOf(c)
    const input = await body(c)
    if (input.nonce !== undefined) {
      const plan = deps.plans.take(input.nonce)
      const op = opNamed(plan.op)
      const resource = await resourceNamed(plan.resource)
      const planned = plan.inProcess ? { inProcess: plan.inProcess } : { cmd: plan.cmd, args: plan.args, writes: plan.writes }
      return c.json(deps.executor.submit({ op, resource, planned }), 202)
    }
    const op = opNamed(String(input.op))
    if (needsConfirm(op)) {
      throw new HttpError(403, `"${op.id}" changes something or reaches the network, so it runs only with a confirmation: ` +
        `POST /api/operations/${op.id}/plan, then send its nonce here.`)
    }
    const { resource, planned } = await prepare(op.id, input)
    return c.json(deps.executor.submit({ op, resource, planned }), 202)
  })

  app.get('/api/jobs', c => c.json(deps.jobs.list(c.req.query('resource'))))
  app.get('/api/jobs/:id', c => {
    const job = deps.jobs.get(c.req.param('id'))
    if (!job) throw new HttpError(404, `No job "${c.req.param('id')}".`)
    return c.json({ job, log: deps.jobs.readLog(job.id) })
  })
  app.delete('/api/jobs/:id', c => {
    knownActorOf(c)
    if (!deps.executor.cancel(c.req.param('id'))) throw new HttpError(409, `Job "${c.req.param('id')}" is not running or waiting.`)
    return c.json({ cancelled: true })
  })
}
