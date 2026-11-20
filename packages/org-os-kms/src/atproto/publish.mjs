// packages/org-os-kms/src/atproto/publish.mjs — plan (pure) then apply. Validation all-or-nothing; application per-record.
import { createHash } from 'node:crypto';
import * as fw from '../framework.mjs';
import { rewriteRefs, resolverFrom } from '../refs.mjs';
import { slugFromRef } from '../manifest.mjs';
import { packPublishRules } from '../pack-publish.mjs';
import { visibilityFloor, scrubUnpublishedRefs } from '../visibility.mjs';
import { isClaim, claimFloor, claimView, CLAIM_RECORD_FIELDS } from '../claims.mjs';

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function contentHash(record) { return createHash('sha256').update(stable(record)).digest('hex'); }

/**
 * `shared` ({ [schema]: { doc, toRecord } }, from loadSharedLexicons) puts a schema in a shared lexicon: the record is
 * toRecord(object), validated against `doc`, and the collection is doc.id, not nsidFor(schema, authority). A toRecord
 * that returns null leaves the object canon-only. Core types are unchanged.
 */
export function planPublish({ items: given, all = given, manifest, did, authority, shared = {}, publishClaims = false, claimPublisher }) {
  const claimConfig = { publish: { claims: publishClaims, claim_publisher: claimPublisher } };
  // Fail closed: whoever called, a public record's refs never name an object outside `given` (spec 6.3). `all` is the whole canon when known.
  const items = scrubUnpublishedRefs(given, all);
  const lexicons = fw.generateAll({ authority });
  const resolve = resolverFrom(manifest);
  const plan = { ok: true, errors: [], create: [], update: [], delete: [], skip: [], orphans: [], previous: manifest.objects };
  const seen = new Set();
  for (const { schema, object, ref } of items) {
    const sharedEntry = shared[schema] ?? null;
    const collection = sharedEntry ? sharedEntry.doc.id : fw.nsidFor(schema, authority);
    const slug = slugFromRef(ref);
    // A type of a visibility-gated pack must declare both a floor and a field whitelist, or it is refused (fail closed);
    // when declared, the object is cut to the whitelist BEFORE toRecord, which would otherwise keep every non-private key.
    let source = rewriteRefs(object, resolve, schema);
    const rules = packPublishRules(schema);
    if (rules) {
      const missing = ['publish_requires', 'public_fields'].filter((k) => !rules[k]);
      if (missing.length) { plan.errors.push({ slug, errors: [`pack ${rules.pack} is visibility-gated: type ${schema} declares no ${missing.join(' and no ')}`] }); continue; }
      // Fail closed even when a caller skipped the op's filter or an instance gate said yes: the floor is checked again here.
      const floor = visibilityFloor(object, schema);
      if (!floor.ok) { plan.errors.push({ slug, errors: [floor.reason] }); continue; }
      source = Object.fromEntries(Object.entries(source).filter(([k]) => rules.public_fields.includes(k)));
    }
    // A claim (src/claims.mjs) is checked again here, fail closed, whatever called: publishClaims is off unless the caller says so.
    if (isClaim(object)) {
      const cf = claimFloor(object, claimConfig);
      if (!cf.ok) { plan.errors.push({ slug, errors: [cf.reason] }); continue; }
      const marked = claimView(source, claimPublisher);
      source = rules ? { ...source, ...Object.fromEntries(CLAIM_RECORD_FIELDS.filter((k) => marked[k] !== undefined).map((k) => [k, marked[k]])) } : marked;
    }
    const record = sharedEntry ? sharedEntry.toRecord(source) : fw.toRecord(source, collection);
    if (record === null) continue; // no home in the shared lexicon: stays canon-only (and is deleted below if it was published)
    const v = fw.validateRecord(record, sharedEntry ? sharedEntry.doc : lexicons[collection]);
    if (!v.ok) { plan.errors.push({ slug, errors: v.errors }); continue; }
    const id = object.id; seen.add(id);
    const hash = contentHash(record);
    const prev = manifest.objects[id];
    const op = { id, slug, type: schema, collection, rkey: id, record, hash };
    const prevCollection = prev ? (prev.collection ?? fw.nsidFor(prev.type, authority)) : null;
    if (!prev) plan.create.push(op);
    else if (prevCollection !== collection) {
      // The collection changed (a namespace swap): swapRecord names a record in the OLD collection, so it cannot be an update.
      // Create in the new collection; delete the old record. `moved` tells applyPublish the manifest now belongs to the new one.
      plan.create.push(op);
      plan.delete.push({ id, slug: prev.slug, type: prev.type, collection: prevCollection, rkey: prev.rkey, moved: true });
    }
    else if (prev.hash === hash) plan.skip.push(id); else plan.update.push({ ...op, swapRecord: prev.cid });
  }
  for (const [id, prev] of Object.entries(manifest.objects)) if (!seen.has(id)) plan.delete.push({ id, slug: prev.slug, type: prev.type, collection: prev.collection ?? fw.nsidFor(prev.type, authority), rkey: prev.rkey });
  // Stale copies an earlier run could not delete (manifest.orphans): retried every run, including after their object was withdrawn.
  // One whose collection+rkey now names a record this run writes or keeps is live again: it is dropped, never deleted.
  const live = new Set([...plan.create, ...plan.update].map((o) => `${o.collection}/${o.rkey}`));
  for (const id of plan.skip) { const m = manifest.objects[id]; if (m) live.add(`${m.collection ?? fw.nsidFor(m.type, authority)}/${m.rkey}`); }
  plan.orphans = (manifest.orphans ?? []).filter((o) => !live.has(`${o.collection}/${o.rkey}`));
  return plan.errors.length ? { ...plan, ok: false, create: [], update: [], delete: [], skip: [], orphans: [] } : plan;
}

export async function applyPublish(plan, { client, did, now = () => new Date().toISOString() }) {
  if (!plan.ok) throw new Error('applyPublish called with a failed plan');
  const manifest = { version: 1, objects: {} };
  for (const id of plan.skip) manifest.objects[id] = plan.previous[id];
  const out = { applied: { created: 0, updated: 0, deleted: 0 }, failures: [], manifest };
  const orphans = [];
  for (const [kind, ops] of [['created', plan.create], ['updated', plan.update]]) {
    for (const op of ops) {
      try {
        const { uri, cid } = await client.putRecord({ repo: did, collection: op.collection, rkey: op.rkey, record: op.record, swapRecord: op.swapRecord });
        manifest.objects[op.id] = { slug: op.slug, type: op.type, rkey: op.rkey, collection: op.collection, atUri: uri, cid, hash: op.hash, publishedAt: now() };
        out.applied[kind]++;
      } catch (e) { out.failures.push({ id: op.id, error: e.message }); if (kind === 'updated' || plan.previous[op.id]) manifest.objects[op.id] = plan.previous[op.id]; }
    }
  }
  for (const op of plan.delete) {
    // A moved record is deleted from its old collection only once its new copy exists.
    if (op.moved && out.failures.some((f) => f.id === op.id)) continue;
    try { await client.deleteRecord({ repo: did, collection: op.collection, rkey: op.rkey }); out.applied.deleted++; }
    catch (e) {
      // A moved record's NEW copy is already tracked; restoring the old entry would lose it. The stale copy is kept on
      // manifest.orphans and its delete is retried on every later run, so it is reported now and not forgotten.
      if (op.moved) { out.failures.push({ id: op.id, error: `the record was created in its new collection, but the old copy in ${op.collection} could not be deleted: ${e.message}` }); orphans.push({ id: op.id, collection: op.collection, rkey: op.rkey }); }
      else { out.failures.push({ id: op.id, error: e.message }); manifest.objects[op.id] = plan.previous[op.id]; }
    }
  }
  for (const o of plan.orphans ?? []) {
    try { await client.deleteRecord({ repo: did, collection: o.collection, rkey: o.rkey }); out.applied.orphansDeleted = (out.applied.orphansDeleted ?? 0) + 1; }
    catch (e) { out.failures.push({ id: o.id, error: `the stale copy in ${o.collection} could not be deleted (it will be retried): ${e.message}` }); orphans.push(o); }
  }
  if (orphans.length) manifest.orphans = orphans;
  return out;
}
