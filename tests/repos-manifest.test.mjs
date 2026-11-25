import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveManifest } from '../scripts/repos-manifest.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'repos-manifest.mjs');
const cur = { baseDirectory: 'repos', repositories: [{ name: 'old', url: 'https://github.com/a/old.git', branch: 'main' }] };

test('no mounted System leaves the manifest untouched', () => {
  assert.deepEqual(deriveManifest([{ id: 's', kind: 'repo', url: 'https://github.com/a/site' }], cur),
    { manifest: null, notes: ['repos.manifest.json left as it is: no repo System has a mount yet'] });
});

test('a mounted System is written, and an unmapped entry is kept with a note', () => {
  const { manifest, notes } = deriveManifest([{ id: 'site', kind: 'repo', url: 'https://github.com/a/site', mount: 'repos/site' }], cur);
  assert.deepEqual(manifest.repositories, [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'main' },
    { name: 'old', url: 'https://github.com/a/old.git', branch: 'main' }]);
  assert.equal(manifest.baseDirectory, 'repos');
  assert.deepEqual(notes, ['repos.manifest.json: "old" isn\'t mapped as a System yet']);
});

test('a mount outside baseDirectory is skipped with a note', () => {
  const { manifest, notes } = deriveManifest([
    { id: 'x', kind: 'repo', url: 'https://github.com/a/x', mount: 'vendor/x' },
    { id: 'site', kind: 'repo', url: 'https://github.com/a/site', mount: 'repos/site', branch: 'dev' }], cur);
  assert.deepEqual(manifest.repositories[0], { name: 'site', url: 'https://github.com/a/site.git', branch: 'dev' });
  assert.ok(notes.includes('system "x": mount vendor/x is outside repos/; not in the manifest'));
});

test('baseDirectory defaults to repos when there was no manifest', () => {
  const { manifest } = deriveManifest([{ id: 'site', kind: 'repo', url: 'https://github.com/a/site', mount: 'repos/site' }], null);
  assert.equal(manifest.baseDirectory, 'repos');
  assert.equal(manifest.repositories.length, 1);
});

test('the CLI writes nothing when nothing changed (byte-identical file, same mtime)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repos-manifest-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'systems.yaml'), 'systems:\n  - id: site\n    kind: repo\n    url: https://github.com/a/site\n    mount: repos/site\n');
  const run = () => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const file = join(dir, 'repos.manifest.json');
  const first = readFileSync(file, 'utf8');
  assert.equal(first, JSON.stringify({ baseDirectory: 'repos', repositories: [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'main' }] }, null, 2) + '\n');
  const m1 = statSync(file).mtimeMs;
  const r = run();
  assert.equal(r.status, 0);
  assert.equal(readFileSync(file, 'utf8'), first);
  assert.equal(statSync(file).mtimeMs, m1);
});

const sys = (o) => ({ id: 'site', kind: 'repo', url: 'https://github.com/a/site', mount: 'repos/site', ...o });

test('a same-name entry is merged: ssh url, pinned branch and extra keys survive', () => {
  const old = { name: 'site', url: 'git@github.com:a/site.git', branch: 'dev', depth: 1 };
  const { manifest, notes } = deriveManifest([{ id: 'site', kind: 'repo', mount: 'repos/site' }], { baseDirectory: 'repos', repositories: [old] });
  assert.deepEqual(manifest.repositories, [old]);
  assert.deepEqual(notes, []);
  const r = deriveManifest([sys({})], { baseDirectory: 'repos', repositories: [old] });
  assert.deepEqual(r.manifest.repositories, [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'dev', depth: 1 }]);
  assert.deepEqual(r.notes, ['repos.manifest.json: "site" url changed to https://github.com/a/site.git (from data/systems.yaml)']);
  const b = deriveManifest([sys({ branch: 'next' })], { baseDirectory: 'repos', repositories: [old] });
  assert.equal(b.manifest.repositories[0].branch, 'next');
});

test('nested mounts and duplicate names are skipped with notes', () => {
  const { manifest, notes } = deriveManifest([
    sys({ id: 'deep', mount: 'repos/a/site' }),
    sys({ id: 'first' }),
    sys({ id: 'second', url: 'https://github.com/b/site' })], null);
  assert.deepEqual(manifest.repositories.map((e) => e.url), ['https://github.com/a/site.git']);
  assert.deepEqual(notes, [
    'system "deep": mount repos/a/site is more than one folder under repos/; not in the manifest',
    'system "second": another System already mounts repos/site; not in the manifest']);
});

test('a System with no url is skipped; a url ending in .git is not doubled', () => {
  const { manifest, notes } = deriveManifest([sys({ id: 'n', url: '', mount: 'repos/n' }), sys({ url: 'https://github.com/a/site.git' })], null);
  assert.deepEqual(manifest.repositories, [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'main' }]);
  assert.deepEqual(notes, ['system "n": no url; not in the manifest']);
});

test('a malformed systems.yaml makes the CLI exit 1 and write nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repos-manifest-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'systems.yaml'), 'systems: [\n  - id: x\n  bad: : :\n');
  const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(dir, 'repos.manifest.json')), false);
});

test('only the first same-name entry is merged; a later one is kept as it is, with a note (parked item)', () => {
  const first = { name: 'site', url: 'https://github.com/a/site.git', branch: 'dev' };
  const extra = { name: 'site', url: 'https://github.com/fork/site.git', branch: 'main', note: 'fork' };
  const { manifest, notes } = deriveManifest([sys({})], { baseDirectory: 'repos', repositories: [first, cur.repositories[0], extra] });
  assert.deepEqual(manifest.repositories, [{ name: 'site', url: 'https://github.com/a/site.git', branch: 'dev' },
    cur.repositories[0], extra]);
  assert.deepEqual(notes, ['repos.manifest.json: "old" isn\'t mapped as a System yet',
    'repos.manifest.json: "site" appears more than once; the extra entry is kept as it is']);
});

test('a malformed repos.manifest.json with no mounted System: exit 0, the file untouched (M2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repos-manifest-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'systems.yaml'), 'systems:\n  - id: site\n    kind: repo\n    url: https://github.com/a/site\n');
  const file = join(dir, 'repos.manifest.json');
  writeFileSync(file, '{ not json');
  const m1 = statSync(file).mtimeMs;
  const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /repos\.manifest\.json left as it is: no repo System has a mount yet/);
  assert.equal(readFileSync(file, 'utf8'), '{ not json');
  assert.equal(statSync(file).mtimeMs, m1);
});
