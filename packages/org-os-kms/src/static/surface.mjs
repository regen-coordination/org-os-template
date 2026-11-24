// packages/org-os-kms/src/static/surface.mjs — the non-AT-Proto publication target. Projected, allowlisted, absolute URLs, merged manifest.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../framework.mjs';
import { publicViewOf, claimFloor } from '../claims.mjs';
import { removePublicPages } from '../pages/owned.mjs';
import { loadDrawing } from '../drawing.mjs';
import { readReads } from '../reads.mjs';

// Never add extensions.yaml here: it is GENERATED below from the instance's packs, never copied from a hand-authored root file.
const WELL_KNOWN_ALLOW = ['dao.json'];
// Geo pointers anyone may read. Everything else under `geo:` (author_space — a personal space —, space_kind, property/type ids, vocabularies) is apply-only config.
const GEO_PUBLIC = new Set(['network', 'space', 'parent_space']);
const publicGeo = (g) => { if (!g || typeof g !== 'object') return undefined; const out = Object.fromEntries(Object.entries(g).filter(([k]) => GEO_PUBLIC.has(k))); return Object.keys(out).length ? out : undefined; };

// Async: with publish.pages: true it loads the pages (and through them the map package) first, before anything is
// written, so a missing map package fails the surface plainly and leaves the output folder as it was (R-38).
export async function writeStaticSurface({ dir, outDir = 'public', items, allItems = items, manifest, config }) {
  const baseUrl = config.publish?.base_url?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('publish.base_url is required for the static surface');
  if (typeof outDir !== 'string' || !outDir || isAbsolute(outDir)) throw new Error('outDir must be a relative path inside dir');
  const rel = relative(resolve(dir), resolve(dir, outDir));
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('outDir must be a relative path inside dir');
  const pages = config.publish?.pages === true ? await loadDrawing('pages', 'publish.pages') : null;
  const CONTEXT = `${baseUrl}/api/context.jsonld`;
  const out = join(dir, outDir); const files = [];
  // This function owns the api/ subtree: drop stale entries (unpublished / opted-out / deleted objects) before rewriting.
  rmSync(join(out, 'api'), { recursive: true, force: true });
  const write = (rel, data) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); files.push(rel); };

  write('api/context.jsonld', fw.toJsonLdContext(undefined, { packs: (config.packs || []).map((p) => p.name) }));
  const bySchema = new Map();
  for (const { schema, object } of items) {
    const m = manifest.objects[object.id];
    const entry = { ...publicViewOf(object, { schema, publisher: config.publish?.claim_publisher }), '@context': CONTEXT, ...(m ? { atUri: m.atUri, cid: m.cid } : {}) }; // @context last: an object's own can never override the absolute URL
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema).push(entry);
  }
  const schemas = [...bySchema.keys()].sort();
  for (const s of schemas) {
    const entries = bySchema.get(s);
    write(`api/${s}.json`, { '@context': CONTEXT, type: s, count: entries.length, items: entries });
    for (const e of entries) write(`api/${s}/${e.id}.json`, e);
  }
  write('api/index.json', {
    name: `${config.instance || 'org-os-kms'} knowledge API`,
    description: 'Static, read-only JSON-LD over the published knowledge objects of this instance. Entries carry atUri when published to AT Proto.',
    endpoints: schemas.flatMap((s) => [{ path: `${baseUrl}/api/${s}.json`, description: `All ${s} entries.` }, { path: `${baseUrl}/api/${s}/{id}.json`, description: `One ${s} by id.` }]),
    access: { readOnly: true, authentication: 'none' },
  });

  const rootKm = join(dir, '.well-known', 'knowledge.json');
  const km = existsSync(rootKm) ? JSON.parse(readFileSync(rootKm, 'utf8')) : { '@context': 'https://www.daostar.org/schemas', type: 'KnowledgeManifest', domains: [], sources: [] };
  const authority = config.atproto?.nsid_authority;
  // Who this instance reads (peer DIDs / source base_urls) is disclosed only on an explicit `publish.disclose_subscriptions: true`.
  const subscribed = config.publish?.disclose_subscriptions !== true ? [] : (config.connectors || []).flatMap((c) => c.name === 'atproto' ? (c.config?.peers || []) : c.config?.base_url ? [c.config.base_url] : []);
  // allItems is the whole canon: a claim-marked source-system object (an opt-in type) would put its steward, a person, into this file. Same floor as the rest of publish.
  const cards = allItems.filter((i) => fw.publishableTypes(config).includes('source-system') && i.schema === 'source-system' && fw.PUBLISHABLE_PUBLIC_USE.includes(i.object.public_use) && claimFloor(i.object, config, i.schema).ok).map(({ object }) => ({ title: object.title, url: object.url, steward: object.steward }));
  const sources = [...(km.sources || [])];
  for (const c of cards) if (!sources.some((s) => s.title === c.title)) sources.push(c);
  write('.well-known/knowledge.json', { ...km, did: config.atproto?.did ?? km.did, geo: publicGeo(config.geo ?? km.geo), exchange: { published_domains: authority ? schemas.map((s) => fw.nsidFor(s, authority)) : [], subscribed_domains: subscribed }, sources });

  // Extension packs: publish this instance's Layer-B set (type names + maps_to_core only — no instance data) so a peer can
  // run federateCheck({ extensionsPath }) against it. Keyed on THIS instance's packs, never on the process-wide registry,
  // and written only when there are packs so a pack-less surface is unchanged.
  if (config.packs?.length) {
    mkdirSync(join(out, '.well-known'), { recursive: true });
    writeFileSync(join(out, '.well-known', 'extensions.yaml'), yaml.dump({ entities: fw.extensionEntities({ packs: config.packs.map((p) => p.name) }) }));
    files.push('.well-known/extensions.yaml');
  } else rmSync(join(out, '.well-known', 'extensions.yaml'), { force: true });

  for (const f of WELL_KNOWN_ALLOW) {
    const src = join(dir, '.well-known', f);
    if (existsSync(src)) { mkdirSync(join(out, '.well-known'), { recursive: true }); copyFileSync(src, join(out, '.well-known', f)); files.push(`.well-known/${f}`); }
  }
  // Pages are opt-in. Either way, drop what an earlier pages run wrote (only if its marker is there); write them again when asked.
  if (pages) {
    let reads = {};
    let reads_warning;
    try { reads = readReads(dir); } catch (e) { reads = {}; reads_warning = `data/kms-reads.json not read: ${e.message}`; } // pages still written, without "read N d ago"
    files.push(...pages.writePublicPages({ out, items, allItems, manifest, config, reads }));
    return reads_warning ? { files, reads_warning } : { files };
  } else removePublicPages(out);
  return { files };
}
