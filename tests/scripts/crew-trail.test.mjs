// tests/scripts/crew-trail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  briefOf, freeId, isoLocal, localDate, readRecord, readTrail, slugify, trailDir, updateRecord, writeRecord,
} from '../../scripts/crew/trail.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'crew-trail-'));

test('slugify makes a short lowercase slug', () => {
  assert.equal(slugify('Fix the KMS cursor race'), 'fix-the-kms-cursor-race');
});

test('slugify survives accents, slashes, emoji and length', () => {
  assert.equal(slugify('Revisão do índice / seção 2'), 'revisao-do-indice-secao-2');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('🚀🚀🚀'), 'work');
  assert.equal(slugify(''), 'work');
  const long = slugify('word '.repeat(100));
  assert.ok(long.length <= 40, long);
  assert.doesNotMatch(long, /^-|-$/);
  assert.match(slugify('a\nb\tc'), /^a-b-c$/);
});

test('localDate and isoLocal format the local time', () => {
  const d = new Date(2026, 9, 10, 20, 31, 5); // local time
  assert.equal(localDate(d), '2026-10-10');
  assert.match(isoLocal(d), /^2026-10-10T20:31:05[+-]\d\d:\d\d$/);
});

test('a record round-trips, and its timestamps stay strings', () => {
  const path = join(trailDir(tmp()), 'a.md');
  const data = { id: 'a', status: 'working', task: null, created: '2026-10-10T20:31:00-03:00' };
  writeRecord(path, data, '## Brief\n\nDo the thing.');
  const back = readRecord(path);
  assert.deepEqual(back.data, data);
  assert.equal(typeof back.data.created, 'string');
  assert.equal(briefOf(back.body), 'Do the thing.');
});

test('updateRecord merges fields and keeps the body', () => {
  const path = join(trailDir(tmp()), 'a.md');
  writeRecord(path, { id: 'a', status: 'seating' }, '## Brief\n\nText.\n');
  const data = updateRecord(path, { status: 'working', pane: 'w1:p1' });
  assert.deepEqual(data, { id: 'a', status: 'working', pane: 'w1:p1' });
  assert.equal(briefOf(readRecord(path).body), 'Text.');
});

test('two reads of the same file do not share an object', () => {
  const path = join(trailDir(tmp()), 'a.md');
  writeRecord(path, { id: 'a', status: 'working' }, '## Brief\n\nx\n');
  const first = readRecord(path);
  first.data.status = 'mutated';
  assert.equal(readRecord(path).data.status, 'working');
});

test('briefOf stops at the next section and tolerates a brief that looks like frontmatter', () => {
  assert.equal(briefOf('## Brief\n\nLine one.\nLine two.\n\n## Commands\n\n- x\n'), 'Line one.\nLine two.');
  assert.equal(briefOf('no brief here'), '');
  const path = join(trailDir(tmp()), 'a.md');
  writeRecord(path, { id: 'a', status: 'working' }, '## Brief\n\n---\nid: fake\n---\n');
  assert.equal(readRecord(path).data.id, 'a');
});

test('freeId adds a numeric suffix on collision', () => {
  const root = tmp();
  assert.equal(freeId(root, '2026-10-10-engineer-x'), '2026-10-10-engineer-x');
  writeRecord(join(trailDir(root), '2026-10-10-engineer-x.md'), { id: 'x', status: 'working' }, 'b');
  assert.equal(freeId(root, '2026-10-10-engineer-x'), '2026-10-10-engineer-x-2');
  writeRecord(join(trailDir(root), '2026-10-10-engineer-x-2.md'), { id: 'x2', status: 'working' }, 'b');
  assert.equal(freeId(root, '2026-10-10-engineer-x'), '2026-10-10-engineer-x-3');
});

test('readTrail separates assignments, handoffs and unreadable files', () => {
  const root = tmp();
  assert.deepEqual(readTrail(root), { assignments: [], handoffs: [], unreadable: [] });
  const dir = trailDir(root);
  writeRecord(join(dir, '2026-10-10-engineer-x.md'), { id: '2026-10-10-engineer-x', status: 'working' }, '## Brief\n\nBuild x.\n');
  writeRecord(join(dir, 'handoff-2026-10-10-y.md'), { id: 'handoff-2026-10-10-y', status: 'open' }, '## Brief\n\nReview y.\n');
  writeFileSync(join(dir, 'mangled.md'), '---\nid: [unclosed\n---\nbody\n');
  writeFileSync(join(dir, 'no-status.md'), '---\nid: no-status\n---\nbody\n');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');
  mkdirSync(join(dir, 'sub.md'));
  const trail = readTrail(root);
  assert.deepEqual(trail.assignments.map((a) => [a.id, a.brief, a.file]), [
    ['2026-10-10-engineer-x', 'Build x.', join(dir, '2026-10-10-engineer-x.md')],
  ]);
  assert.deepEqual(trail.handoffs.map((h) => h.id), ['handoff-2026-10-10-y']);
  assert.deepEqual(trail.unreadable, ['mangled.md', 'no-status.md']);
});
