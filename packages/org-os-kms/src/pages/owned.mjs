// packages/org-os-kms/src/pages/owned.mjs — what the public pages own under `out`, and how an earlier run is removed.
// Kept apart from write.mjs (which draws) so the static surface can drop old pages without loading the house or the
// map (spec §9: kms runs vendored alone; R-38).
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const OWNED = ['index.html', 'k', '_kms'];
export const MARKER = join('_kms', '.kms-pages');

/** Remove what an earlier pages run wrote. Only when the marker is there. Returns true if it removed. */
export function removePublicPages(out) {
  if (!existsSync(join(out, MARKER))) return false;
  for (const p of OWNED) rmSync(join(out, p), { recursive: true, force: true });
  return true;
}
