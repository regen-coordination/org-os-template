// packages/org-os-kms/test/pages-write.test.mjs — publish.pages: the commons as pages beside the API (Task 19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { writeStaticSurface } from '../src/static/surface.mjs';
import * as F from './fixtures/pages/commons.mjs';

const mk = () => { const dir = mkdtempSync(join(tmpdir(), 'kms-pages-')); mkdirSync(join(dir, '.well-known')); writeFileSync(join(dir, '.well-known', 'dao.json'), '{"type":"DAO"}'); return dir; };
const cfg = (publish = {}, render) => ({ ...F.config, ...(render ? { render } : {}), publish: { base_url: 'https://kc.example', ...publish } });
const run = (dir, publish, o = {}) => writeStaticSurface({ dir, items: F.items, allItems: F.allItems, manifest: F.manifest, config: cfg(publish, o.render), ...(o.outDir ? { outDir: o.outDir } : {}) });
const snap = (root) => {
  const out = {};
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out[relative(root, p)] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  if (existsSync(root)) walk(root);
  return out;
};
const all = (root) => Object.keys(snap(root));

test('without publish.pages the public/ tree is byte-identical to a run with the flag absent', async () => {
  const a = mk(); const b = mk();
  await run(a, {}); await run(b, { pages: false });
  assert.deepEqual(snap(join(a, 'public')), snap(join(b, 'public')));
  assert.ok(!existsSync(join(a, 'public', 'index.html')) && !existsSync(join(a, 'public', 'k')) && !existsSync(join(a, 'public', '_kms')));
});

test('with it: index, one page per own gated entry, kind pages, search.json, fonts', async () => {
  const dir = mk(); const { files } = await run(dir, { pages: true });
  const pub = join(dir, 'public');
  for (const f of ['index.html', 'k/encyclopedia-entry/index.html', 'k/encyclopedia-entry/id-living-mulch.html', 'k/concept-lineage/id-cover-cropping.html', '_kms/search.json', '_kms/fonts/geist-latin.woff2', '_kms/.kms-pages', 'api/index.json']) {
    assert.ok(existsSync(join(pub, f)), f); assert.ok(files.includes(f), `${f} reported`);
  }
  assert.ok(JSON.parse(readFileSync(join(pub, '_kms/search.json'), 'utf8')).some((r) => r.t === 'Living mulch'));
  assert.match(readFileSync(join(pub, 'index.html'), 'utf8'), /url\("_kms\/fonts\/geist-latin\.woff2"\)/);
  assert.match(readFileSync(join(pub, 'k/encyclopedia-entry/id-living-mulch.html'), 'utf8'), /url\("\.\.\/\.\.\/_kms\/fonts\/geist-latin\.woff2"\)/);
  assert.match(readFileSync(join(pub, 'k/encyclopedia-entry/index.html'), 'utf8'), /url\("\.\.\/\.\.\/_kms\/fonts\/fraunces/);
});

test('pages list only gated entries: no file and no title for an internal entry; no page for a peer copy; no map link', async () => {
  const dir = mk(); await run(dir, { pages: true });
  const pub = join(dir, 'public');
  assert.ok(!existsSync(join(pub, 'k/encyclopedia-entry/id-staff-handbook.html')));
  assert.ok(!existsSync(join(pub, 'k/resource/id-seed-saving.html')), 'peer entry: a row that links out, no page (R-34)');
  for (const f of all(pub)) {
    if (/\.(woff2|txt)$/.test(f) || f.startsWith('api/')) continue;
    const t = readFileSync(join(pub, f), 'utf8');
    assert.ok(!t.includes('Staff handbook') && !t.includes('staff-handbook'), `${f} names the internal entry`);
    assert.ok(!t.includes('Seed swap notes'), `${f} names the other internal entry`);
    if (f.endsWith('.html')) assert.ok(!/Federation map/.test(t), `${f} links the map (R-32)`);
  }
});

test('a re-run removes pages of entries no longer published', async () => {
  const dir = mk(); await run(dir, { pages: true });
  const pub = join(dir, 'public');
  assert.ok(existsSync(join(pub, 'k/concept-lineage/id-cover-cropping.html')));
  const rest = F.items.filter((i) => i !== F.cover);
  await writeStaticSurface({ dir, items: rest, allItems: rest, manifest: F.manifest, config: cfg({ pages: true }) });
  assert.ok(!existsSync(join(pub, 'k/concept-lineage/id-cover-cropping.html')));
  assert.ok(!existsSync(join(pub, 'k/concept-lineage')), 'emptied kind folder gone');
  assert.ok(existsSync(join(pub, 'k/encyclopedia-entry/id-living-mulch.html')));
});

test('pages:false removes what kms wrote and leaves a foreign index.html alone', async () => {
  const dir = mk(); await run(dir, { pages: true }); await run(dir, { pages: false });
  const pub = join(dir, 'public');
  assert.ok(!existsSync(join(pub, 'index.html')) && !existsSync(join(pub, 'k')) && !existsSync(join(pub, '_kms')));
  assert.ok(existsSync(join(pub, 'api', 'index.json')));
  const other = mk(); mkdirSync(join(other, 'public'), { recursive: true });
  writeFileSync(join(other, 'public', 'index.html'), 'hand made');
  await run(other, {});
  assert.equal(readFileSync(join(other, 'public', 'index.html'), 'utf8'), 'hand made');
  await assert.rejects(run(other, { pages: true }), /did not write/, 'pages on refuses to overwrite a foreign index.html');
  assert.equal(readFileSync(join(other, 'public', 'index.html'), 'utf8'), 'hand made');
});

test('fonts: system writes no _kms/fonts', async () => {
  const dir = mk(); await run(dir, { pages: true }, { render: { fonts: 'system' } });
  const pub = join(dir, 'public');
  assert.ok(existsSync(join(pub, 'index.html')));
  assert.ok(!existsSync(join(pub, '_kms', 'fonts')));
  assert.ok(!/woff2/.test(readFileSync(join(pub, 'index.html'), 'utf8')));
});

test('outDir outside dir still throws with pages on', async () => {
  const dir = mk();
  await assert.rejects(run(dir, { pages: true }, { outDir: '../escape' }), /outDir/);
});

// ── the steward's preview (Task 20) ─────────────────────────────────────────
import yaml from 'js-yaml';
import { writePreview } from '../src/pages/write.mjs';
import { dispatch } from '../src/cli.mjs';

function instanceDir(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-prev-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'encyclopedia-entry.yaml'), yaml.dump({ entries: {
    'living-mulch': { title: 'Living mulch', type: 'encyclopedia-entry', public_use: 'ok-with-caveat', maturity: 'reviewed', summary: 'A cover crop kept growing between rows.', related_concepts: ['staff-handbook', 'no-such-note'] },
    'staff-handbook': { title: 'Staff handbook', type: 'encyclopedia-entry', public_use: 'internal-only', summary: 'How the crew works.' },
    'seed-notes': { title: 'Seed notes', type: 'encyclopedia-entry', public_use: 'ok-with-caveat', maturity: 'raw', summary: 'Waiting for a look.' },
  } }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 'Example DAO Commons', adapter: 'repo-data', target: '.', publish: { base_url: 'https://kc.example', ...extra } }));
  return dir;
}
const NOW = '2026-10-29T12:00:00Z';
const entryPages = (root) => all(root).filter((f) => /^k\/[^/]+\/[^/]+\.html$/.test(f) && !f.endsWith('/index.html'));
const pageTitled = (root, t) => readFileSync(join(root, entryPages(root).find((f) => readFileSync(join(root, f), 'utf8').includes(`<h1 class="ed-title">${t}</h1>`))), 'utf8');

test('preview: every canon entry has a page, the internal one with the lock; nothing under public/', async () => {
  const dir = instanceDir();
  mkdirSync(join(dir, 'public', 'api'), { recursive: true }); writeFileSync(join(dir, 'public', 'api', 'index.json'), '{}'); writeFileSync(join(dir, 'public', 'index.html'), 'mine');
  const before = snap(join(dir, 'public'));
  const r = await writePreview({ dir, now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(snap(join(dir, 'public')), before, 'public/ byte-unchanged');
  assert.ok(!existsSync(join(dir, 'renders', 'preview', 'search.json')));
  assert.equal(r.report.entries, 3); assert.equal(r.report.internal, 1); assert.equal(r.report.broken, 1);
  const root = join(dir, 'renders', 'preview');
  assert.equal(entryPages(root).length, 3);
  const internal = pageTitled(root, 'Staff handbook');
  assert.match(internal, /Internal to Example DAO Commons — not published/);
});

test('preview: the broken ref and the awaiting entry appear, with the fix', async () => {
  const dir = instanceDir();
  const r = await writePreview({ dir, now: NOW });
  assert.equal(r.report.awaiting, 1);
  const root = join(dir, 'renders', 'preview');
  const page = pageTitled(root, 'Living mulch');
  assert.match(page, /no-such-note/);
  assert.match(page, /No entry with this name\. Fix the reference or publish the entry\./);
  const idx = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(idx, /Awaiting review|Needs review/i);
});

test('preview: a static_dir of renders cannot receive preview files; the root is fixed', async () => {
  const dir = instanceDir({ static_dir: 'renders' });
  await writePreview({ dir, now: NOW });
  assert.ok(existsSync(join(dir, 'renders', 'preview', 'index.html')));
  assert.ok(!existsSync(join(dir, 'renders', 'index.html')) && !existsSync(join(dir, 'renders', 'k')));
});

test('preview: no api/ link anywhere (R-33); the map link only when the map exists (R-32)', async () => {
  const dir = instanceDir();
  await writePreview({ dir, now: NOW });
  const root = join(dir, 'renders', 'preview');
  for (const f of all(root).filter((x) => x.endsWith('.html'))) assert.ok(!/href="[^"]*api\//.test(readFileSync(join(root, f), 'utf8')), `${f} carries an api/ link`);
  assert.ok(!/federation-map/.test(readFileSync(join(root, 'index.html'), 'utf8')));
  mkdirSync(join(dir, 'renders'), { recursive: true }); writeFileSync(join(dir, 'renders', 'federation-map.html'), '<p>map</p>');
  await writePreview({ dir, now: NOW });
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /href="\.\.\/federation-map\.html"/);
  const kind = readFileSync(join(root, 'k', 'encyclopedia-entry', 'index.html'), 'utf8');
  assert.match(kind, /href="\.\.\/\.\.\/\.\.\/federation-map\.html"/);
  const entry = pageTitled(root, 'Living mulch');
  assert.match(entry, /href="\.\.\/\.\.\/\.\.\/federation-map\.html"/);
});

test('preview: publish.gate demotes an entry, so the preview shows it as internal (same selection as publish)', async () => {
  const dir = instanceDir({ gate: 'gate.mjs' });
  writeFileSync(join(dir, 'gate.mjs'), 'export function isPublishable(o){ return o.maturity === "reviewed" ? { ok: true } : { ok: false, reason: "not reviewed" }; }');
  const r = await writePreview({ dir, now: NOW });
  assert.equal(r.report.internal, 2, 'handbook (floor) and seed notes (gate)');
  assert.match(pageTitled(join(dir, 'renders', 'preview'), 'Seed notes'), /Internal to Example DAO Commons — not published/);
  assert.doesNotMatch(pageTitled(join(dir, 'renders', 'preview'), 'Living mulch'), /Internal to/);
});

test('preview: a rerun replaces the folder (no stale pages)', async () => {
  const dir = instanceDir();
  await writePreview({ dir, now: NOW });
  const stale = join(dir, 'renders', 'preview', 'k', 'encyclopedia-entry', 'gone.html'); writeFileSync(stale, 'x');
  await writePreview({ dir, now: NOW });
  assert.ok(!existsSync(stale));
});

test('cli: render pages --preview routes; without --preview it explains (P-6)', async () => {
  assert.deepEqual(dispatch(['render', 'pages', '--preview'], { dry: true }), { verb: 'render', args: ['pages'], flags: { preview: true } });
  const dir = instanceDir();
  const bad = await dispatch(['render', 'pages', '--dir', dir]);
  assert.match(bad.error, /writes the steward's preview only \(--preview\)/);
  const ok = await dispatch(['render', 'pages', '--preview', '--dir', dir]);
  assert.equal(ok.ok, true);
  assert.ok(existsSync(join(dir, 'renders', 'preview', 'index.html')));
});

test('a throw midway leaves a marker: a pages-on re-run succeeds, a pages-off re-run leaves nothing', async () => {
  const { writePublicPages } = await import('../src/pages/write.mjs');
  for (const rerunOn of [true, false]) {
    const dir = mk(); await run(dir, {}); const out = join(dir, 'public');
    let n = 0;
    assert.throws(() => writePublicPages({ out, items: F.items, allItems: F.allItems, manifest: F.manifest, config: cfg({ pages: true }), _renderEntry: () => { if (++n === 2) throw new Error('boom'); return '<p>x</p>'; } }), /boom/);
    assert.ok(existsSync(join(out, '_kms', '.kms-pages')) && existsSync(join(out, 'index.html')), 'partial pages are marked');
    await run(dir, { pages: rerunOn });
    assert.equal(existsSync(join(out, 'index.html')), rerunOn);
    if (!rerunOn) assert.ok(!existsSync(join(out, 'k')) && !existsSync(join(out, '_kms')));
  }
});

test('a malformed reads sidecar is reported, and pages are still written', async () => {
  const dir = mk(); mkdirSync(join(dir, 'data')); writeFileSync(join(dir, 'data', 'kms-reads.json'), '{nope');
  const r = await run(dir, { pages: true });
  assert.match(r.reads_warning, /kms-reads\.json not read/);
  assert.ok(existsSync(join(dir, 'public', 'index.html')));
  assert.equal((await run(mk(), { pages: true })).reads_warning, undefined);
});

test('a symlinked k or _kms is removed as a link; its target is untouched', async () => {
  const { symlinkSync, rmSync } = await import('node:fs');
  const dir = mk(); await run(dir, { pages: true });
  const pub = join(dir, 'public'); const elsewhere = mkdtempSync(join(tmpdir(), 'kms-target-'));
  writeFileSync(join(elsewhere, 'keep.txt'), 'mine');
  rmSync(join(pub, 'k'), { recursive: true }); symlinkSync(elsewhere, join(pub, 'k'));
  await run(dir, { pages: false });
  assert.ok(!existsSync(join(pub, 'k')));
  assert.equal(readFileSync(join(elsewhere, 'keep.txt'), 'utf8'), 'mine');
  await run(dir, { pages: true });
  rmSync(join(pub, '_kms', 'fonts'), { recursive: true }); symlinkSync(elsewhere, join(pub, '_kms', 'fonts'));
  await run(dir, { pages: false });
  assert.ok(!existsSync(join(pub, '_kms')));
  assert.equal(readFileSync(join(elsewhere, 'keep.txt'), 'utf8'), 'mine');
});
