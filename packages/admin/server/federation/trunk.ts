// federation.yaml as committed on the trunk (network N2; the shared trunk reader of ruling R13).
//
// Network writes plan from the trunk, never from the working tree or a staged change (R14, the 11-22 constraint
// "writes plan from the trunk"): a peer an operator has staged but not applied is not yet this org's word. Publishing
// (Task 7) reads it here; asking, receiving and migration (Tasks 8, 11, 12) read it the same way.
import { parse } from 'yaml'
import { readFederation } from '../../lib/federation/read.mjs'
import { validTrunkName } from '../../lib/rules.mjs'
import { showFile } from '../git.ts'
import { resolveTrunk } from '../proposals/ledger.ts'

export type TrunkFederation = { trunk: string; doc: Record<string, unknown>; fed: ReturnType<typeof readFederation> }

/** federation.yaml at the tip of the trunk, read and parsed, or the sentence saying why it can't be. */
export async function readTrunkFederation(repo: string, startBranch?: string): Promise<TrunkFederation | { problem: string }> {
  let trunk: string
  try { trunk = await resolveTrunk(repo, startBranch) } catch { return { problem: "The trunk can't be found." } }
  if (validTrunkName(trunk) !== true) return { problem: `"${trunk}" can't be the trunk. Name another in data/governance.yaml (governance.trunk).` }
  let text: string
  try { text = await showFile(repo, `refs/heads/${trunk}`, 'federation.yaml') } catch {
    return { problem: `federation.yaml isn't on the trunk (${trunk}) yet.` }
  }
  let doc: unknown
  try { doc = parse(text) } catch { return { problem: `federation.yaml on the trunk (${trunk}) isn't valid YAML.` } }
  const obj = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : {}
  return { trunk, doc: obj, fed: readFederation(obj) }
}
