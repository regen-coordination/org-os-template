import { requestText } from '../../../lib/federation/request.mjs'
import type { Transport } from './types.ts'

/** Always available: the request is saved as a file for the operator to send by any channel. The hub imports the
 *  file; the node is told by whatever channel carried it, so there is no poll, status or reply. */
export const fileTransport: Transport = {
  id: 'file',
  label: 'Save a file to send',
  unavailable: () => null,
  ready: async () => null,
  send: async request => ({ ref: `file:${request.id}`, summary: 'Saved as a file to send.', text: requestText(request) }),
}
