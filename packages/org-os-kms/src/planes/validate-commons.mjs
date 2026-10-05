// Re-gates the published store against the CANON's live context — never against the commons itself
// (it is a projection, not a second canon). The commons runs no gate of its own; this is its safety net.
import fs from 'node:fs';
import path from 'node:path';
import { validatePublishedKb } from './validate-published-kb.mjs';
import { loadKb } from './kb-loader.mjs';
import { loadCommonsPolicy } from './kms-config.mjs';
import { resolvePublicPlane } from './paths.mjs';

/**
 * @param {{ root: string, outDir?: string }} opts root = the canon; outDir = the public plane (resolved from the canon when omitted)
 * @returns {{ ok: boolean, errors: string[], message: string }}
 */
export function validateCommons({ root, outDir = resolvePublicPlane({ root }).dir }) {
  const publishedDir = path.join(outDir, 'data', 'kb');
  // The SAME type policy the export selected with, read from the commons' own kms.yaml — otherwise
  // this check and the exporter disagree about extension-pack types and every opted-in
  // territorial-unit/data-stream is reported as unpublishable on a store that is in fact correct.
  // A commons that is not scaffolded yet (no kms.yaml) has no policy to read: fall through to the
  // framework's core default rather than crashing on ENOENT, since the "nothing published yet"
  // message below is the useful answer in that state.
  const cfgFile = path.join(outDir, 'kms.yaml');
  const { types, fields } = fs.existsSync(cfgFile) ? loadCommonsPolicy({ commonsDir: outDir }) : {};
  const errors = validatePublishedKb({ publishedDir, kb: loadKb(path.join(root, 'data', 'kb')), types, fields });
  if (errors.length) return { ok: false, errors, message: errors.join('\n') };
  const message = fs.existsSync(publishedDir)
    ? 'commons published store valid'
    : `no published store at ${publishedDir} — nothing to validate yet (canon control data is clean)`;
  return { ok: true, errors: [], message };
}
