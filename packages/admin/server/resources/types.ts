import type { SystemReader } from '../systems/reader.ts'

/** The two canvases. A resource lives on exactly one. */
export type Board = 'organization' | 'systems'

export type Kind =
  | 'project' | 'person' | 'funding' | 'partner' | 'idea' | 'knowledge-gaps'
  | 'module' | 'role' | 'seat' | 'instance' | 'source' | 'channel' | 'connector' | 'system'
  | 'proposal'
  | 'absent'

export type EdgeKind =
  | 'lead' | 'member' | 'champion' | 'submitted' | 'works-on' | 'funds' | 'partners-with'
  | 'depends-on' | 'seat-of' | 'federation' | 'held-by'
  | 'touches' | 'proposed-by'

export interface Attention { level: 'warn' | 'alert'; text: string }
export interface Changed { at: string; by: string }

/** Where a resource came from, and whether the M1 form can edit it. */
export interface ResourceSource { path: string; editable: boolean; registry?: string; entityId?: string }

export interface Resource {
  id: string            // "<kind>:<id in its source>"
  kind: Kind
  board: Board
  name: string
  status: string | null // the source's own word, shown in the pill
  attention: Attention | null
  changed: Changed | null
  facts: Record<string, unknown>
  source: ResourceSource | null
}

/** The federation map's edge shape, so ids and links mean the same thing in both maps. */
export interface Edge { from: string; to: string; kind: EdgeKind; crosses?: boolean }
export interface Graph { nodes: Resource[]; edges: Edge[] }

export interface Portal { id: string; toBoard: Board; text: string; targets: string[] }
export interface BoardView { board: Board; nodes: Resource[]; edges: Edge[]; portals: Portal[] }

export const BOARD_OF: Record<Exclude<Kind, 'absent'>, Board> = {
  project: 'organization', person: 'organization', funding: 'organization', partner: 'organization',
  idea: 'organization', 'knowledge-gaps': 'organization',
  module: 'systems', role: 'systems', seat: 'systems', instance: 'systems',
  source: 'systems', channel: 'systems', connector: 'systems',
  system: 'systems', // the default: the systems adapter places each entry by its section
  proposal: 'organization',
}

/** An adapter either reads its source or says, in one sentence, why there is nothing to read. A source
 *  that is not here asks nothing of the person; `failed` marks one that should have been and could not
 *  be read, which does. */
export type AdapterResult = Graph | { absent: string; failed?: boolean }

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export type Runner = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<RunResult>

export interface AdapterContext {
  repo: string
  now: () => Date
  run: Runner
  /** When operation `op` last ended `ok` on `resource` (ISO), or null. */
  lastOk: (op: string, resource: string) => string | null
  /** Reads outside systems through their drivers. Absent: an offline reader (no network). */
  systems?: SystemReader
}

export interface Adapter {
  name: string    // 'records' | 'modules' | 'crew' | 'fleet' | 'sources' | 'systems' | 'proposals'
  board: Board    // where its absence card is drawn
  title: string   // the absence card's name
  watch: string[] // repo-relative paths; a change under one re-reads this adapter
  read(ctx: AdapterContext): Promise<AdapterResult>
}
