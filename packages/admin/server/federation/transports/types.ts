// The request transport interface (network N2 Task 5, spec §14 R11): a transport carries a request to a hub.
// Transports are plugins: callers go through the registry, never to one by name.
import type { FederationRequest } from '../../../lib/federation/request.mjs'
import type { Runner } from '../../resources/types.ts'

export type TransportId = 'file' | 'github' | 'hosted' | 'p2p' | 'atproto' | (string & {})
export interface Sent { ref: string; summary: string; text?: string }
export interface Incoming { ref: string; text: string }
export interface Status { state: 'waiting' | 'accepted' | 'refused'; reason?: string }
/** `run` defaults to `runCommand` (server/resources/run.ts); it inherits the process env. */
export interface TransportCtx { run: Runner; repo: string; signal?: AbortSignal }
export interface Transport {
  id: TransportId
  label: string
  /** Synchronous, like Operation.unavailable: shape only (the hub's `where`, an invite). */
  unavailable(where: string | null, request: FederationRequest | null): string | null
  /** Asynchronous checks of this machine (gh installed, signed in). */
  ready(ctx: TransportCtx): Promise<string | null>
  send(request: FederationRequest, where: string | null, ctx: TransportCtx): Promise<Sent>
  poll?(where: string, ctx: TransportCtx): Promise<Incoming[]>
  status?(ref: string, ctx: TransportCtx): Promise<Status>
  reply?(ref: string, outcome: { kind: 'accepted' | 'refused'; sentence: string }, ctx: TransportCtx): Promise<void>
}
