import { assemble } from './graph.ts'
import { runCommand } from './run.ts'
import { records } from './adapters/records.ts'
import { modules } from './adapters/modules.ts'
import { crew } from './adapters/crew.ts'
import { fleet } from './adapters/fleet.ts'
import { sources } from './adapters/sources.ts'
import { systems } from './adapters/systems.ts'
import { proposals } from './adapters/proposals.ts'
import type { Adapter, AdapterContext, AdapterResult, Graph } from './types.ts'

export const ADAPTERS: Adapter[] = [records, modules, crew, fleet, sources, systems, proposals]

/** The graph, kept per adapter: an adapter is read again only after a path it watches changed,
 *  or after `invalidateAdapter` (crew's live state changes without touching a file). */
export class ResourceStore {
  private cache = new Map<string, AdapterResult>()
  private last: Graph | null = null
  /** What the last `refresh` saw; kept apart from `last` so a read between an invalidation
   *  and the refresh cannot hide a change from the refresh. */
  private published = new Map<string, string>()
  /** Bumped by every invalidation, so a read that started before one is not cached after it. */
  private generation = new Map<string, number>()
  /** The refresh in flight; the next one waits behind it. */
  private refreshing: Promise<unknown> = Promise.resolve()

  constructor(private ctx: AdapterContext, private adapters: Adapter[] = ADAPTERS) {}

  async graph(): Promise<Graph> {
    const results: { adapter: Adapter; result: AdapterResult }[] = []
    for (const adapter of this.adapters) {
      let result = this.cache.get(adapter.name)
      if (!result) {
        const started = this.generation.get(adapter.name) ?? 0
        result = await adapter.read(this.ctx).catch((err: unknown) =>
          ({ absent: `${adapter.title} could not be read: ${err instanceof Error ? err.message : String(err)}`, failed: true }))
        // An invalidation during the read means this result may already be stale: use it once, do not keep it.
        if ((this.generation.get(adapter.name) ?? 0) === started) this.cache.set(adapter.name, result)
      }
      results.push({ adapter, result })
    }
    this.last = assemble(results)
    return this.last
  }

  /** Forget every adapter that watches `rel` (a path relative to the repository, with `/`). */
  invalidate(rel: string): boolean {
    let hit = false
    for (const a of this.adapters) {
      if (a.watch.some(w => rel === w || rel.startsWith(`${w}/`))) { this.invalidateAdapter(a.name); hit = true }
    }
    return hit
  }

  invalidateAdapter(name: string): void {
    this.generation.set(name, (this.generation.get(name) ?? 0) + 1)
    this.cache.delete(name)
  }

  /** Read what was forgotten; answer the ids of resources that changed, appeared or went. */
  refresh(): Promise<string[]> {
    // One at a time: overlapping refreshes would race on `published` and drop or repeat ids.
    const run = this.refreshing.then(() => this.refreshNow(), () => this.refreshNow())
    this.refreshing = run.catch(() => {})
    return run
  }

  private async refreshNow(): Promise<string[]> {
    const graph = await this.graph()
    const now = new Map(graph.nodes.map(n => [n.id, JSON.stringify(n)]))
    const ids: string[] = []
    for (const [id, text] of now) if (this.published.get(id) !== text) ids.push(id)
    for (const id of this.published.keys()) if (!now.has(id)) ids.push(id)
    this.published = now
    return ids
  }

  liveSeats(): boolean {
    return (this.last?.nodes ?? []).some(n => n.kind === 'seat' && n.facts.state !== null && n.facts.state !== undefined)
  }

  watchPaths(): string[] { return [...new Set(this.adapters.flatMap(a => a.watch))] }
}

/** The whole graph of one instance, without a server: for scripts, agents, and the cockpit. */
export async function readResources(repo: string, opts: Partial<AdapterContext> = {}): Promise<Graph> {
  return new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null, ...opts }).graph()
}
