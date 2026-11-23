// The transport registry. Callers use `transports()` and `transportOf(id)`; adding a transport changes no caller.
import type { Transport, TransportId } from './types.ts'
import { fileTransport } from './file.ts'
import { githubPlaceholder, hostedTransport, p2pTransport, atprotoTransport } from './waiting.ts'

const registry: Transport[] = [fileTransport, githubPlaceholder, hostedTransport, p2pTransport, atprotoTransport]

export const transports = (): readonly Transport[] => registry.slice()
export const transportOf = (id: TransportId): Transport | null => registry.find(t => t.id === id) ?? null

/** Adds a transport (replacing one with the same id). Returns the function that removes it, or restores the one it replaced. */
export function registerTransport(t: Transport): () => void {
  const at = registry.findIndex(x => x.id === t.id)
  const replaced = at >= 0 ? registry[at] : null
  if (at >= 0) registry[at] = t; else registry.push(t)
  return () => {
    const i = registry.indexOf(t)
    if (i < 0) return
    if (replaced) registry[i] = replaced; else registry.splice(i, 1)
  }
}
