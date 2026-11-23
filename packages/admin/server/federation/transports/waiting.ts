import type { Transport } from './types.ts'

/** A transport that is registered so it shows up, but does not exist yet. `send` throws. */
function waiting(id: string, label: string, sentence: string): Transport {
  return {
    id, label,
    unavailable: () => sentence,
    ready: async () => sentence,
    send: async () => { throw new Error(sentence) },
  }
}

export const hostedTransport = waiting('hosted', 'Send through a hosted hub', 'Comes with hosted hubs, after sign-in.')
export const p2pTransport = waiting('p2p', 'Send peer to peer', 'Comes later.')
/** Requests never reach atproto (Q8, R27); this one is registered so the public route shows as waiting until the network index exists (decision 8). */
export const atprotoTransport = waiting('atproto', 'Publish a request (public)', 'Comes with the network index.')
