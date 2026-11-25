import { statSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse } from 'yaml'
import type { PeerIO } from '../lib/federation/peers.mjs'

/** The disk behind the pure link-state check: folders and their federation.yaml, read as they are. */
export const nodePeerIO: PeerIO = {
  resolve,
  isDir: abs => { try { return statSync(abs).isDirectory() } catch { return false } },
  readFederationAt: abs => {
    const file = join(abs, 'federation.yaml')
    if (!existsSync(file)) return { found: false }
    try { return { found: true, doc: parse(readFileSync(file, 'utf8')) } }
    catch (e) { return { found: true, error: String((e as Error)?.message ?? e).split('\n')[0] } }
  },
}
