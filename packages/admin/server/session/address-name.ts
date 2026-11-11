// packages/admin/server/session/address-name.ts
//
// How a CAIP-10 actor no member holds is named (L5 §6.3, R-L5-7.4): the name of the lowest hat they wear and their short
// address. One function, for a signed-in actor (request.ts) and for anyone a page shows (names.ts `displayNames`).

import { lowestHat } from '../actor.ts'
import { shortAddress } from '../systems/safe.ts'
import type { Membership } from './membership.ts'
import { parseCaip10 } from '../../lib/caip.mjs'

/** A role id or a hat's pretty id written as a name: its first letter capital, `-` and `_` as spaces (R-L5-21.3). */
export const asName = (id: string): string => (/^[a-z]/.test(id) ? `${id[0]!.toUpperCase()}${id.slice(1).replace(/[-_]+/g, ' ')}` : id)

/** A CAIP-10 account's name: the name of the lowest of `hats` (`Membership.hatName`: its role, else `details`, given only
 *  for a viewer who may read the tree, else its pretty id) and the short address ("Council · 0x0000…00A1"); the short
 *  address alone when they wear none here. */
export function addressName(membership: Membership | null, account: string, hats: readonly string[], details?: ReadonlyMap<string, string>): string {
  const address = parseCaip10(account)?.address ?? account
  const lowest = lowestHat(hats)
  return lowest && membership ? `${asName(membership.hatName(lowest, details))} · ${shortAddress(address)}` : shortAddress(address)
}
