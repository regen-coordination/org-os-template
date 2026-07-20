import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueCobToRecord, patchCobToRecord, parsePatchId, parseIssueId } from '../src/cob.mjs';

test('issueCobToRecord maps to an org-os record preserving the COB oid', () => {
  const cob = { id: 'aabbccddeeff00112233445566778899aabbccdd', title: 'Broken sync', state: { status: 'open' }, author: { id: 'did:key:z6Mkxxx' } };
  const rec = issueCobToRecord(cob);
  assert.equal(rec.kind, 'issue');
  assert.equal(rec.title, 'Broken sync');
  assert.equal(rec.status, 'open');
  assert.equal(rec.source_lineage.cob_oid, cob.id);
  assert.equal(rec.source_lineage.type, 'xyz.radicle.issue');
});

test('patchCobToRecord maps a patch COB to a change record', () => {
  const cob = { id: '0011223344556677889900112233445566778899', title: 'Add feature', state: { status: 'open' } };
  const rec = patchCobToRecord(cob);
  assert.equal(rec.kind, 'change');
  assert.equal(rec.source_lineage.type, 'xyz.radicle.patch');
});

test('parsePatchId / parseIssueId extract the COB oid from rad stdout', () => {
  assert.equal(parsePatchId('✓ Patch 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 opened'), '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567');
  assert.equal(parseIssueId('✓ Issue 1122334455667788990011223344556677889900 opened'), '1122334455667788990011223344556677889900');
  assert.equal(parsePatchId('no id here'), null);
});
