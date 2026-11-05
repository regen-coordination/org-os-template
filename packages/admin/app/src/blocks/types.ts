import type { ComponentType, ReactNode } from 'react'
import type { StageOp } from '../api.ts'
import type { MarkContext } from '../parts/marks.ts'

export type BlockState = 'loading' | 'ready' | 'empty' | 'error' | 'notYet' | 'unavailable'
export interface BlockCtx { now: Date; marks: MarkContext; stage: (ops: StageOp[]) => Promise<void> }
export interface BlockData { state: BlockState; data?: unknown; count?: number; error?: string; age?: string }
export interface ConfigField { key: string; label: string; input: 'text' | 'number' | 'select' | 'fields' | 'kind' | 'yaml' | 'markdown'; options?: string[] }

/** What a block is given: a board's block entry (P4c `BlockEntry`) without its id, type and place. */
export interface BlockCfg { title?: string; source?: unknown; view?: Record<string, unknown>; text?: string }

/** The frame's options, read from `view` by every type (Rulings). */
export interface FrameView {
  note?: string                              // a line beside the title
  link?: { href: string; label: string }     // a link beside the title, in place of the note
  count?: 'title' | 'note' | 'none'          // where the count goes; default 'none'
  noun?: string                              // with count 'note': "3 seats"
  empty?: string                             // the empty sentence
  quiet?: boolean                            // drawn only when it has rows: nothing while loading, empty or not yet; a failure still shows
}

/** Where `where` reads: a record's own fields, the derived `needs`, `changed` and `free`, else its facts. */
export type Where = Record<string, unknown>

/** What a records block reads (interfaces P4-C9): `kind` names one or several (`'*'` any), or
 *  `section` takes a built-in section's membership; name one of them, or neither for every record. */
export interface RecordSource { kind?: string | string[]; section?: string; where?: Where; sort?: string | string[]; limit?: number }

export interface BlockDef<C = BlockCfg> {
  type: string
  label: string
  config: ConfigField[]
  title: (cfg: C) => string
  useData: (cfg: C, ctx: BlockCtx) => BlockData
  Body: ComponentType<{ cfg: C; data: unknown; ctx: BlockCtx }>
  Foot?: ComponentType<{ cfg: C; ctx: BlockCtx }>
  /** Controls drawn around the body, or the Note for its state, in every state (a list's List · Map
   *  switch); what they set reaches the body through the type's own context. Bare blocks draw them too; `bare` says
   *  the page head carries the page's primary (a lone list's Add, design pass 2026-11-04). */
  Tools?: ComponentType<{ cfg: C; ctx: BlockCtx; state: BlockState; bare?: boolean; children: ReactNode }>
  /** What the block says when it is empty, in place of its empty line (a section list's plate, design pass
   *  2026-11-04); its heading sits under the page's h1 when the block is bare. Without one, the Note. */
  Empty?: ComponentType<{ cfg: C; ctx: BlockCtx; bare: boolean }>
  actions?: Record<string, (...args: never[]) => StageOp[]>
  needs?: 'P2' | 'P3'
}
