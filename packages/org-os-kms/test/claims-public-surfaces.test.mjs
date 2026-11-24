// packages/org-os-kms/test/claims-public-surfaces.test.mjs — what a claim shows on every public surface (seat-7 fixes F2, F6).
// A claim is ReFi DAO's record ABOUT a node. Its home-only evidence (the node's consent date, the superseded_by pointer) and
// whatever the operator keeps beside it (a contact) never leave: not in the record, the static API, the pages or standard.site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStaticSurface } from '../src/static/surface.mjs';
import { buildCommons } from '../src/pages/model.mjs';
import { toDocument } from '../src/atproto/standard-site.mjs';
import { planPublish } from '../src/atproto/publish.mjs';

const CONSENT = '2026-11-19'; const CONTACT_MAIL = 'pat@node-a.example'; const CONTACT_NAME = 'Pat Quill';
const claim = (extra = {}) => ({ id: 'claim-1', type: 'organization', title: 'Node A', public_use: 'ok-with-caveat', url: 'https://node-a.example',
  description: 'A cooperative that farms oats.', claim_for: 'https://node-a.example', claim_status: 'claimed', claim_node_did: 'did:plc:nodeaaaaaaaaaaaaaaaaaaaa',
  claim_checked_on: '2026-11-18', consent_atproto: CONSENT, superseded_by: 'at://did:plc:x/y/z', notes: 'private note',
  contact_email: CONTACT_MAIL, contact_name: CONTACT_NAME, claimed_by: 'Operator Sam', ...extra });
const item = (object = claim()) => ({ schema: 'organization', ref: 'data/kb/organization.yaml#node-a', object });
const config = { instance: 't', publish: { base_url: 'https://t.example', pages: false, claims: true, claim_publisher: 'ReFi DAO' }, atproto: { did: 'did:plc:me', nsid_authority: 'xyz.example.kb' } };
const manifest = { version: 1, objects: {} };

async function staticJson(object) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-static-'));
  mkdirSync(join(dir, '.well-known'));
  await writeStaticSurface({ dir, items: [item(object)], manifest, config });
  return JSON.parse(readFileSync(join(dir, 'public', 'api', 'organization', 'claim-1.json'), 'utf8'));
}
const model = (object) => buildCommons({ items: [item(object)], manifest, config, now: '2026-11-20T00:00:00Z', mode: 'public' });

test('F2 static API: a claim carries no consent date and no superseded_by', async () => {
  const j = await staticJson(claim());
  assert.equal(j.consent_atproto, undefined); assert.equal(j.superseded_by, undefined);
  assert.equal(j.claim_for, 'https://node-a.example'); assert.equal(j.claim_status, 'claimed');
});

test('F2 pages: the page model of a claim carries no consent date and no superseded_by', () => {
  const s = JSON.stringify(model(claim()));
  assert.ok(!s.includes(CONSENT), s); assert.ok(!s.includes('at://did:plc:x/y/z'), s);
});

test('F2 standard.site: a document of a claim carries no consent date, even when an operator maps a field to it', () => {
  const { record } = toDocument(item(), { did: 'did:plc:me', authority: 'xyz.example.kb', publicationUri: 'at://did:plc:me/site.standard.publication/p', settings: { fields: { organization: { description: 'consent_atproto' } } } });
  assert.ok(!JSON.stringify(record ?? {}).includes(CONSENT));
});

test('a plain object is unchanged by the claim view on every surface', async () => {
  const plain = { id: 'claim-1', type: 'organization', title: 'Plain', public_use: 'ok-with-caveat', consent_atproto: CONSENT };
  assert.equal((await staticJson(plain)).consent_atproto, CONSENT, 'not a claim: the static API is as it was');
});

// ---- F6: a claim is cut to an allow-list, whatever else sits on the object ----
// Allowed: id, title, type, public_use, url, description, the claim marks (claim_for, claim_status, claim_node_did,
// claim_checked_on), publisher, and the fields the commons field policy (src/planes/public-fields.mjs) declares public for the
// schema (for a visibility-gated pack type, its declared public_fields). Everything else stays home.
const KEPT = { org_type: 'cooperative', legal_form: 'SCCL' };
const HOME = ['contact_email', 'contact_name', 'claimed_by', 'notes', 'consent_atproto', 'superseded_by', 'internal_ref'];
const plan = (object) => planPublish({ items: [item(object)], manifest, did: 'did:plc:me', authority: 'xyz.example.kb', publishClaims: true, claimPublisher: 'ReFi DAO' });
const text = (o) => JSON.stringify(o);

test('F6 record: a claim carries its allow-list and nothing else (no contact, no claimed_by, no consent, no unknown field)', () => {
  const p = plan(claim({ ...KEPT, internal_ref: 'zzz-internal' }));
  assert.equal(p.ok, true, text(p.errors));
  const rec = p.create[0].record;
  for (const k of HOME) assert.equal(rec[k], undefined, k);
  for (const v of [CONTACT_MAIL, CONTACT_NAME, 'Operator Sam', CONSENT, 'zzz-internal']) assert.ok(!text(rec).includes(v), v);
  assert.equal(rec.title, 'Node A'); assert.equal(rec.claim_for, 'https://node-a.example'); assert.equal(rec.claim_status, 'claimed');
  assert.equal(rec.publisher, 'ReFi DAO'); assert.equal(rec.claim_checked_on, '2026-11-18'); assert.equal(rec.claim_node_did, 'did:plc:nodeaaaaaaaaaaaaaaaaaaaa');
  assert.equal(rec.org_type, 'cooperative', 'a declared public content field of the schema is kept');
});

test('F6 static API: the same allow-list, with the publisher stamped', async () => {
  const j = await staticJson(claim({ ...KEPT, internal_ref: 'zzz-internal' }));
  for (const k of HOME) assert.equal(j[k], undefined, k);
  assert.equal(j.publisher, 'ReFi DAO'); assert.equal(j.org_type, 'cooperative'); assert.equal(j.claim_for, 'https://node-a.example');
});

test('F6 pages: the page model carries no contact, claimed_by or unknown field, and keeps the declared content', () => {
  const s = text(model(claim({ ...KEPT, internal_ref: 'zzz-internal' })));
  for (const v of [CONTACT_MAIL, CONTACT_NAME, 'Operator Sam', CONSENT, 'zzz-internal', 'private note']) assert.ok(!s.includes(v), v);
  assert.ok(s.includes('cooperative') && s.includes('A cooperative that farms oats.'));
});

test('F6: a plain (non-claim) object is not cut by the claim allow-list', async () => {
  const j = await staticJson({ id: 'claim-1', type: 'organization', title: 'Plain', public_use: 'ok-with-caveat', internal_ref: 'kept-as-before' });
  assert.equal(j.internal_ref, 'kept-as-before');
});
