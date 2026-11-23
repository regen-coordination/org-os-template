// The launcher's Join door (network N2 Task 14): look a hub up before any instance is chosen, and say where a
// freshly opened instance should land so it can start asking.
//
// - A pasted invite link is `<hub's federation.json url>#invite=<token>`. The fragment is split off HERE, before the
//   address goes anywhere, and only the fact that an invite was there is returned: the token is never fetched, stored,
//   logged or answered. The launcher's page keeps it in memory and adds it to the landing address in the browser.
// - The look-up is the person pressing "Look it up": the one network read this door makes, under the same guards as
//   every federation.json read (fetchFederationJson).
import { readFederation } from '../lib/federation/read.mjs'
import { fetchFederationJson, wellKnownUrlOf, type GuardDeps } from '../server/federation/remote.ts'

export type JoinPolicy = 'invite' | 'open-with-approval' | 'open' | 'closed'
export interface JoinHub {
  name: string; type: string | null
  /** The address to ask at, as given (without any fragment). */
  url: string
  /** The hub's first network, or null when it names none. A hub with several lists them all under `networks`. */
  network: string | null; networks: string[]
  policy: JoinPolicy; types: string[]; asks: string[]
}

export const SENTENCES = {
  empty: 'Paste the hub\'s address or an invite link.',
  notAddress: "That isn't a public https address. Paste the hub's address, or the invite link it gave you.",
  badInvite: "That invite link has no invite in it. Copy the whole link again, or paste the hub's address.",
} as const

/** Splits a pasted address from its fragment. `invite` is whether an invite was there; the token itself is dropped. */
export function splitInviteLink(pasted: string): { address: string } & ({ invite: boolean } | { problem: string }) {
  const text = pasted.trim()
  const at = text.indexOf('#')
  const address = (at < 0 ? text : text.slice(0, at)).trim()
  if (at < 0) return { address, invite: false }
  const fragment = text.slice(at + 1)
  if (fragment === '') return { address, invite: false }
  const m = /^invite=(.+)$/.exec(fragment)
  if (!m || m[1]!.trim() === '') return { address, problem: SENTENCES.badInvite }
  return { address, invite: true }
}

export async function inspectHub(pasted: unknown, deps: GuardDeps): Promise<{ hub: JoinHub; invite: boolean } | { error: string; status: number }> {
  if (typeof pasted !== 'string' || pasted.trim() === '') return { error: SENTENCES.empty, status: 400 }
  const split = splitInviteLink(pasted)
  if ('problem' in split) return { error: split.problem, status: 400 }
  if (wellKnownUrlOf(split.address) === null) return { error: SENTENCES.notAddress, status: 400 }
  const got = await fetchFederationJson(split.address, deps)
  if ('problem' in got) return { error: got.problem, status: 502 }
  const doc = got.doc
  const fed = readFederation(doc)
  const join = fed.join
  // R17: no join block is closed, and `open` without its decision works as open-with-approval.
  const policy = !join ? 'closed' : join.policy === 'open' && !join.decision ? 'open-with-approval' : join.policy
  const networks = fed.networks.map(n => n.name)
  return {
    invite: split.invite,
    hub: {
      name: typeof doc.name === 'string' && doc.name !== '' ? doc.name : split.address,
      type: typeof doc.type === 'string' ? doc.type : null,
      url: split.address, network: networks[0] ?? null, networks,
      policy: policy as JoinPolicy, types: join?.types ?? [], asks: join?.asks ?? [],
    },
  }
}

/** Where an opened instance should land to start asking: its Federation page, with the hub and network named in the
 *  query. Never an invite: that travels in the fragment, added by the launcher's page. Anything else is ignored. */
export function landingOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { hub, network } = raw as { hub?: unknown; network?: unknown }
  if (typeof hub !== 'string' || hub.includes('#') || wellKnownUrlOf(hub) === null) return undefined
  const q = new URLSearchParams({ hub: hub.trim() })
  if (typeof network === 'string' && network.trim() !== '' && network.length <= 200) q.set('network', network.trim())
  return `/federation?${q.toString()}`
}
