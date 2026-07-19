// src/connectors/synthefy.mjs — SPECCED STUB. Synthefy — protocol details UNKNOWN in this
// workspace; this connector is a placeholder whose spec is deliberately OPEN.
//
// IMPLEMENTATION SPEC — OPEN, needs protocol docs before building:
//  - TODO: auth model (API key? OAuth? wallet?).
//  - TODO: object model (what are Synthefy's native records?).
//  - TODO: cursor model (how does Synthefy express "changed since"?).
//  - TODO: describe type (provisionally 'database') + return_path.
//  - map: once the object model is known, translate to resource/signal.
import { makeStub } from './stub.mjs';

export const synthefyConnector = makeStub({
  name: 'synthefy',
  protocol: 'Synthefy',
  type: 'database',
  steward: 'Synthefy account',
  return_path: 'https://synthefy.com',
  spec: 'OPEN — Synthefy protocol docs are not yet available in this workspace. Auth, object '
    + 'model, and cursor model are all TODO. Provisional source-system type is database. This '
    + 'stub exists to reserve the name and prove the contract admits an unknown protocol shape.',
});
