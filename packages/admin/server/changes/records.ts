import type { Referrer } from '../schema.ts'
import type { StageOp } from './types.ts'

// The op projection lives in lib/ops.mjs so the root validator can import it; the server keeps its names.
export { StageError, parseRecord, recordId, projectOp } from '../../lib/ops.mjs'

/** The sentence a delete is refused with while other entries still name it (the reviewed one). */
export function notDeleted(name: string, id: string, refs: Referrer[]): string {
  const named = refs.slice(0, 10).map(r => `${r.registry} "${r.id}" (${r.field})`).join(', ')
  return `Not deleted: ${name} "${id}" is still referred to by ${named}${refs.length > 10 ? ` and ${refs.length - 10} more` : ''}. ` +
    `Nothing was written. Change or remove ${refs.length === 1 ? 'that reference' : 'those references'} first, then delete it.`
}

export const VERB: Record<StageOp['op'], string> = { update: 'update', replace: 'update', create: 'create', delete: 'delete', file: 'edit' }

/** What an op is named by in a subject: a record op by its registry and id, a file op (L6 §11.2) by its path. */
const partOf = (op: StageOp): { op: StageOp; registry: string; id: string; name: string } => {
  if (op.op === 'file') return { op, registry: op.path, id: op.path, name: op.path }
  // Named only: the record was read against the instance's own list when it was staged (a custom collection's too).
  const at = op.record.indexOf(':')
  return { op, registry: at < 0 ? op.record : op.record.slice(0, at), id: at < 0 ? '' : op.record.slice(at + 1), name: op.record }
}

/** One op keeps the reviewed subject; more read as one subject and a line per op. A file op reads `admin(<path>): edit
 *  <path>` (`delete <path>` when it removes the file). */
export function commitMessage(ops: StageOp[]): string {
  const parts = ops.map(partOf)
  const verb = (op: StageOp) => (op.op === 'file' && op.text === null ? 'delete' : VERB[op.op])
  if (parts.length === 1) return `admin(${parts[0]!.registry}): ${verb(parts[0]!.op)} ${parts[0]!.id}`
  const registries = [...new Set(parts.map(p => p.registry))]
  const lines = parts.map(({ op, name }) => `- ${verb(op)} ${name}${op.op === 'update' ? ` (${Object.keys(op.set).join(', ')})` : ''}`)
  return `admin(${registries.join(', ')}): apply ${parts.length} changes\n\n${lines.join('\n')}`
}
