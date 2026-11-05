import type { ProposalView, Resource } from '../../api.ts'
import { changeKeyOf } from '../../hrefs.ts'
import type { Viewer } from '../../viewAs/visibility.ts'

/** The title and the note a proposal about restricted data is shown with (rule 8, R-L5-15.8): the server's words
 *  (`server/private/ops.ts` RESTRICTED_SUBJECT, `server/private/proposals.ts` RESTRICTED_NOTE; a test holds them equal).
 *  The client draws them itself when a preview restricts a view the server gave whole. */
export const RESTRICTED_TITLE = 'A change to a restricted collection'
export const RESTRICTED_NOTE = 'This proposal changes a restricted collection: what it changes is shown only to those admitted to it.'

/** What a viewer not admitted to a proposal's private data is shown in its place (rule 8, R-L5-15.8): the server's
 *  title, its rules, state and events, and none of what it changes. */
export const isRestricted = (view: ProposalView): boolean => (view as { restricted?: unknown }).restricted === true

const privateOf = (view: ProposalView): unknown[] => {
  const p = (view as { private?: unknown }).private
  return Array.isArray(p) ? p : []
}

/** A view as the server shows it to one not admitted to its private data (`shownTo`'s restricted form): the title
 *  "A change to a restricted collection", no ops, no rationale or statement, revise events without their ops, and on
 *  the page no diff (the note instead) and no records. Its rules, evaluation, events and state are kept. */
export function restrictedView<V extends ProposalView>(view: V): V {
  const { rationale: _r, statement: _s, private: _p, ...rest } = view as V & { rationale?: unknown; statement?: unknown; private?: unknown }
  const events = (view.events as unknown as Record<string, unknown>[]).map(e => {
    if (e.kind !== 'revise') return e
    const { ops: _o, ...event } = e
    return event
  })
  return {
    ...rest, title: RESTRICTED_TITLE, ops: [], events, restricted: true,
    ...(Object.hasOwn(view, 'diff') ? { diff: null, note: RESTRICTED_NOTE } : {}),
    ...(Object.hasOwn(view, 'current') ? { current: [] } : {}),
  } as unknown as V
}

/**
 * A proposal as this viewer is shown it (§6.3, E-50, rule 8), or null when it is not shown at all.
 * - You: as the server gave it (the server already judged you).
 * - A preview reads `resources` (absent while they are not read: nothing is shown, failing closed).
 * - Public (L4-R13, the door's view): shown only when the store's record of it is a record Public sees, and every record
 *   its ops touch is found in the resources (by change key) and seen. A missing record, a governance document op or a
 *   create fails closed; a placeholder (a restricted view, or `private` ops) is never public (R-L5-13.2).
 * - Members or a hat: every proposal the store's own record allows is listed, as a member is listed it (R-L5-15.8): in
 *   its restricted form when it carries private ops (`private`, which only an admitted viewer is given) or touches a
 *   record the previewed viewer does not see. A record the resources do not hold (a governance document, a create)
 *   restricts nothing.
 */
export function shownFor<V extends ProposalView>(view: V, resources: readonly Resource[] | undefined, viewer: Viewer, sees: (item: unknown) => boolean): V | null {
  if (viewer.as === 'you') return view
  if (resources === undefined) return null
  const own = resources.find(r => r.id === `proposal:${String(view.id)}`)
  const ops = (view.ops as unknown as { record?: unknown }[] | undefined) ?? []
  const targetOf = (op: { record?: unknown }) => resources.find(r => changeKeyOf(r) === op.record)
  if (viewer.as === 'public') {
    if (!own || !sees(own) || isRestricted(view) || privateOf(view).length > 0) return null
    return ops.every(op => { const t = targetOf(op); return t !== undefined && sees(t) }) ? view : null
  }
  if (own && !sees(own)) return null
  if (isRestricted(view)) return view
  const unseen = ops.some(op => { const t = targetOf(op); return t !== undefined && !sees(t) })
  return privateOf(view).length > 0 || unseen ? restrictedView(view) : view
}
