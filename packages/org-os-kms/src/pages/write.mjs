// packages/org-os-kms/src/pages/write.mjs — the commons as readable pages beside the JSON API (opt-in: publish.pages).
// Owns exactly index.html, k/ and _kms/ under `out`, and says so with out/_kms/.kms-pages. Nothing without that
// marker is ever removed, so an index.html from another tool is left alone.
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildCommons } from './model.mjs';
import { renderIndex, searchIndex } from './render-index.mjs';
import { renderEntry } from './render-entry.mjs';
import { copyFonts } from '../house/fonts.mjs';
import * as fw from '../framework.mjs';
import { loadKmsConfig } from '../config.mjs';
import { selectPublic } from '../gate.mjs';
import { ensureIds } from '../identity.mjs';
import { readManifest } from '../manifest.mjs';
import { readReads } from '../reads.mjs';
import { OWNED, MARKER, removePublicPages } from './owned.mjs';

export { removePublicPages };

/** → relative paths written. Public mode only: this instance's gated entries; a peer's entry gets a row, never a page (R-34). */
export function writePublicPages({ out, items, allItems = items, manifest, config = {}, now = new Date().toISOString(), knowledge, reads = {}, _renderEntry = renderEntry }) {
  removePublicPages(out);
  const foreign = OWNED.filter((p) => existsSync(join(out, p)));
  if (foreign.length) throw new Error(`publish.pages would overwrite ${foreign.join(', ')} in the output folder, which kms did not write; move it or turn publish.pages off`);
  // Claim the folders first: a throw from here on leaves a marker, so the next run (on or off) cleans up what was written.
  const note = join(out, MARKER); mkdirSync(dirname(note), { recursive: true });
  writeFileSync(note, 'Written by org-os-kms publish (publish.pages). Removed and rewritten on each run; delete this file to keep the pages.\n');

  let know = knowledge;
  if (know === undefined) {
    const p = join(out, '.well-known', 'knowledge.json');
    try { know = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { know = null; }
  }
  const commons = buildCommons({ items, allItems, manifest, config, knowledge: know, reads, now, mode: 'public' });
  const mode = config.render?.fonts === 'system' ? 'system' : 'house';
  const opts = { fonts: { mode, embed: 'relative' }, now }; // no mapHref: public pages carry no Federation map link (R-32)
  const files = [];
  const write = (rel, text) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); files.push(rel); };

  write('index.html', renderIndex(commons, opts));
  for (const k of commons.kinds) write(`k/${k.schema}/index.html`, renderIndex(commons, { ...opts, kind: k.schema }));
  for (const e of commons.entries) if (!e.origin) write(e.href, _renderEntry(e, commons, opts));
  write('_kms/search.json', JSON.stringify(searchIndex(commons)) + '\n');
  if (mode === 'house') for (const n of copyFonts(join(out, '_kms', 'fonts'))) files.push(`_kms/fonts/${n}`);
  files.push(MARKER);
  return files;
}

// The steward's preview lives here and nowhere else: not configurable, so a static_dir can never receive it.
const PREVIEW_DIR = join('renders', 'preview');
const MAP_FILE = join('renders', 'federation-map.html');

/**
 * writePreview({ dir, now }) → { ok, report: { wrote, entries, internal, broken, awaiting } }
 * The whole canon as pages in renders/preview/ (never public/): internal entries with the lock, broken refs with
 * their fix, the review queue, "couldn't read" from the reads sidecar. The folder is replaced on each run.
 * "Public" is decided by selectPublic (gate.mjs), the one selection `publish` uses too.
 */
export async function writePreview({ dir, now = new Date().toISOString() }) {
  const config = loadKmsConfig(dir);
  const target = join(dir, config.target);
  const all = fw.getAdapter(config.adapter).list(target);
  const { candidates } = await selectPublic({ dir, config, all });
  // ids are held in memory only: the preview never writes to the canon
  const { items } = ensureIds({ adapter: config.adapter, target, items: candidates, write: false, mintGeo: Boolean(config.geo?.space) });
  const withId = new Map(items.map((i) => [i.ref, i]));
  const allItems = all.map((i) => withId.get(i.ref) ?? i);
  const commons = buildCommons({ items, allItems, manifest: readManifest(dir), config, reads: readReads(dir), now, mode: 'preview' });

  const out = join(dir, PREVIEW_DIR);
  rmSync(out, { recursive: true, force: true });
  const mode = config.render?.fonts === 'system' ? 'system' : 'house';
  const hasMap = existsSync(join(dir, MAP_FILE));
  const base = { preview: true, json: false, fonts: { mode, embed: 'relative' }, now };
  const files = [];
  const write = (rel, text) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); files.push(rel); };
  // mapHref is from the preview's root; the renderers add each page's depth (R-32)
  const mapHref = hasMap ? '../federation-map.html' : null;
  write('index.html', renderIndex(commons, { ...base, mapHref }));
  for (const k of commons.kinds) write(`k/${k.schema}/index.html`, renderIndex(commons, { ...base, kind: k.schema, mapHref }));
  for (const e of commons.entries) if (!e.origin) write(e.href, renderEntry(e, commons, { ...base, mapHref }));
  if (mode === 'house') for (const n of copyFonts(join(out, '_kms', 'fonts'))) files.push(`_kms/fonts/${n}`);
  const own = commons.entries.filter((e) => !e.origin);
  return { ok: true, report: {
    wrote: PREVIEW_DIR, files: files.length, entries: own.length,
    internal: own.filter((e) => e.internal).length,
    broken: own.reduce((n, e) => n + (e.broken?.length ?? 0), 0),
    awaiting: own.filter((e) => e.awaiting).length,
  } };
}
