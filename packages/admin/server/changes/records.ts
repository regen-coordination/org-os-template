import type { Referrer } from '../schema.ts'
import type { StageOp } from './types.ts'
import { parseRecord } from '../../lib/ops.mjs'

// The op projection lives in lib/ops.mjs so the root validator can import it; the server keeps its names.
export { StageError, parseRecord, recordId, projectOp } from '../../lib/ops.mjs'

/** The sentence a delete is refused with while other entries still name it (the reviewed one). */
export function notDeleted(name: string, id: string, refs: Referrer[]): string {
  const named = refs.slice(0, 10).map(r => `${r.registry} "${r.id}" (${r.field})`).join(', ')
  return `Not deleted: ${name} "${id}" is still referred to by ${named}${refs.length > 10 ? ` and ${refs.length - 10} more` : ''}. ` +
    `Nothing was written. Change or remove ${refs.length === 1 ? 'that reference' : 'those references'} first, then delete it.`
}

export const VERB: Record<StageOp['op'], string> = { update: 'update', replace: 'update', create: 'create', delete: 'delete' }

/** One op keeps the reviewed subject; more read as one subject and a line per op. */
export function commitMessage(ops: StageOp[]): string {
  const parts = ops.map(op => ({ op, ...parseRecord(op.record) }))
  if (parts.length === 1) return `admin(${parts[0]!.registry}): ${VERB[parts[0]!.op.op]} ${parts[0]!.id}`
  const registries = [...new Set(parts.map(p => p.registry))]
  const lines = parts.map(({ op }) => `- ${VERB[op.op]} ${op.record}${op.op === 'update' ? ` (${Object.keys(op.set).join(', ')})` : ''}`)
  return `admin(${registries.join(', ')}): apply ${parts.length} changes\n\n${lines.join('\n')}`
}
