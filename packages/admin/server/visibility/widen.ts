// packages/admin/server/visibility/widen.ts
//
// Widening (L5 spec §9.7) is a publication, decided under the org's rules: an op that widens what it writes carries the
// class `publication` beside its registry's (changes/stage.ts `classesOf`, lib/change-classes.mjs `widens`). One widening
// has an owner: a person's own wallet link. It is put in git (`handles.wallet`) only by a proposal whose author is that
// person — their member id, or the CAIP-10 id of that address (Q2/Q50) — and only by them on a direct apply.

import { Refusal } from '../changes/apply.ts'
import { beforeOf } from '../changes/stage.ts'
import type { StageOp } from '../changes/types.ts'
import { walletsWidened } from '../../lib/change-classes.mjs'
import { walletsOf } from '../../lib/hat-readings.mjs'
import { OWN_LINK } from '../../lib/narrow.mjs'

export { OWN_LINK }

/** Refuses (403 `OWN_LINK`) ops that put a wallet address in a member's `handles.wallet` when `actor` is not that person:
 *  neither the member whose record it is nor the address itself. */
export function refuseOthersLink(repo: string, ops: readonly StageOp[], actor: string): void {
  const self = walletsOf({ handles: { wallet: actor } })[0] ?? null
  for (const op of ops) {
    const widened = walletsWidened(op, beforeOf(repo, op))
    if (!widened) continue
    if (actor === widened.member || (self !== null && widened.added.every(a => a === self))) continue
    throw new Refusal(403, { code: 'OWN_LINK', error: OWN_LINK })
  }
}
