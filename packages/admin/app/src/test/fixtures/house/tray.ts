import type { ChangeView, Op } from '../../../api.ts'
import { fakeAddress } from './org.ts'

/** The Changes tray's fixtures (spec §5.6, §17): staged ops on Example DAO's Treasury Safe and the Treasury signer
 *  hat, decided by Council consent or, for the solo specimens, by the member alone. A placeholder member id, never
 *  a person's; the values are fixture values. */

const TREASURY = { id: 'treasury', name: 'Treasury', kind: 'safe', threshold: '4 of 9' }
const SIGNER = { id: 'treasury-signer', name: 'Treasury signer', kind: 'hat', wearers: 9 }

export const THRESHOLD: Op = { op: 'update', record: 'systems:treasury', set: { threshold: '4 of 8' }, base: 'h1', before: TREASURY }
export const NOTE: Op = { op: 'update', record: 'systems:treasury', set: { note: '“threshold now 4 of 8”' }, base: 'h1', before: TREASURY }
export const WEARERS: Op = { op: 'update', record: 'hats:treasury-signer', set: { wearers: 8 }, base: 'h2', before: SIGNER }

export const COUNCIL = { direct: false, proposable: true, sentence: 'Council consent decides this · 4 of 8', source: 'data/governance.yaml: treasury' }
export const SOLO = { direct: true, sentence: 'the steward decides alone', source: 'implied by model: solo-maintainer' }

/** A change as the server gives it: `state` is derived there; here it is what these fixtures stand for. */
export function trayView(over: Partial<ChangeView> = {}): ChangeView {
  return {
    id: 'chg_tray', actor: 'steward-a', created: '2026-10-28T09:00:00Z', updated: '2026-10-28T09:20:00Z',
    ops: [], classes: ['treasury'], rule: COUNCIL, stale: [], current: [], state: 'staged', ...over,
  }
}

/** Collapsed, direct: two staged changes the member applies alone. */
export const STAGED = trayView({ ops: [THRESHOLD, WEARERS], rule: SOLO })
/** Stale: three staged, the signer's op changed on the trunk since. */
export const STALE = trayView({ ops: [THRESHOLD, NOTE, WEARERS], stale: [2], current: [null, null, { ...SIGNER, wearers: 8 }], state: 'stale' })
/** Expanded: three ops on two records, one of them stale, proposed under Council consent. */
export const EXPANDED = STALE

/** Sign-in (§11.4), the other half of the tray's section: Example DAO's members, its Hats tree #13, and a member who
 *  wears two hats at a generated address (§17). Fixture values. */
export const SIGNIN = { org: 'Example DAO', tree: '#13', hats: ['Council steward', 'Treasury signer'], address: fakeAddress(41), doorHref: '/door' }
