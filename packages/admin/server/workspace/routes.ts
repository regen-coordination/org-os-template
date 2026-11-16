// packages/admin/server/workspace/routes.ts
//
// The workspace's HTTP surface (DAO-OS L6 spec §16), mounted once by app.ts. Each part mounts its own routes from its own
// module, one line here: the editors and files (files.ts, §11), the collections, their views and view state
// (collections.ts, §7.3), the pages, their attachments and Record a meeting (pages.ts, §4), the editing sessions
// (sessions.ts, §6), the batched record writes (records.ts, §6), the Sources page's data (sources.ts, §10) and Council memory
// (memory.ts, §14). Every route but the public page reads is a members'
// read or a known actor's write: the public is refused before any route (`publicReads`).

import type { Hono } from 'hono'
import type { PrivateAccess } from '../private/ops.ts'
import { mountCollections } from './collections.ts'
import { mountFiles } from './files.ts'
import { mountMemory } from './memory.ts'
import { mountPages } from './pages.ts'
import { mountRecords, RecordBatches } from './records.ts'
import { EditSessions, mountSessions } from './sessions.ts'
import { mountSources, type SourceReader } from './sources.ts'
import type { Membership } from '../session/membership.ts'

export interface WorkspaceDeps {
  repo: string
  /** The repository's one write lock (app.ts): every git write runs inside it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after a write that stages into a change, so every open tab refreshes its tray. */
  notify: (msg: { type: 'changes' }) => void
  /** The one private store (L5 §10), or why it is not open. */
  privateStore: PrivateAccess
  /** The System reader's cache (§10): what the Sources page and the from mark show. Absent: no System has a read. */
  systems?: SourceReader | null
  /** Membership from the Hats tree, so a page's editor is named by the hat they wear (walk fix wave 4, G9). */
  membership?: Membership | null
}

/** The writes that outlive a request (§6): the open editing sessions and the record batches, one of each per app. The
 *  server flushes both when it stops and reconciles both when it starts (serve.ts). */
export interface WorkspaceWriters { sessions: EditSessions; records: RecordBatches }

const WRITERS = new WeakMap<Hono, WorkspaceWriters>()
/** The app's editing sessions and record batches; null for an app the workspace was not mounted on. */
export const workspaceOf = (app: Hono): WorkspaceWriters | null => WRITERS.get(app) ?? null

export function mountWorkspace(app: Hono, deps: WorkspaceDeps): void {
  const writers: WorkspaceWriters = {
    sessions: new EditSessions(deps.repo, { store: deps.privateStore, withLock: deps.withLock, notify: deps.notify }),
    records: new RecordBatches(deps.repo, { withLock: deps.withLock, notify: deps.notify, privateStore: deps.privateStore }),
  }
  WRITERS.set(app, writers)
  mountFiles(app, { repo: deps.repo })
  mountCollections(app, deps)
  mountPages(app, deps)
  mountSessions(app, writers.sessions)
  mountRecords(app, deps.repo, writers.records)
  mountSources(app, { repo: deps.repo, privateStore: deps.privateStore, systems: deps.systems ?? null })
  mountMemory(app, { repo: deps.repo, withLock: deps.withLock, privateStore: deps.privateStore })
}
