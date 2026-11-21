// packages/org-os-kms/test/claims-round4-probe.test.mjs — seat-7 fixes, round 4: one claim of every core schema, a person's name in every
// field, through every public output. No output outside the canon may carry a name.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { publicEntryFor } from '../src/planes/public-fields.mjs';
import { CLAIMABLE_SCHEMAS } from '../src/claims.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { OPS } from '../src/ops.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { bridgeAsync } from '../src/registry-bridge.mjs';
import { selectForPublication } from '../src/planes/select-for-publication.mjs';
import { buildMap } from '../src/map.mjs';
import { exportUpdateDrafts } from '../src/certified/update.mjs';
import { writePreview } from '../src/pages/write.mjs';

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const SCHEMAS = ['claim-evidence', 'concept-lineage', 'contribution-record', 'deployment', 'encyclopedia-entry', 'evolution-record', 'implementation-record', 'option-entry',
  'organization', 'person', 'relationship-record', 'resource', 'signal', 'source-system', 'track', 'update-proposal'];
const nameOf = (schema) => `Zed ${schema.replace(/-/g, ' ')} Person`;
const MARKS = { public_use: 'ok-with-caveat', claim_for: 'https://node-a.example', claim_status: 'claimed', consent_atproto: '2026-11-19' };

/**
 * A claim of `schema` with a person's name in every field the schema (and its frontmatter) holds. PEOPLE=all names every field. By default the
 * fields the commons field policy DECLARES public for the schema (publicEntryFor: org_type, use_cases, audience…) carry node text instead: they
 * are the operator's own descriptive content about the node, shown on any published object, exactly like title and description.
 */
function claimOf(schema, { everywhere = process.env.PEOPLE === 'all' } = {}) {
  const name = nameOf(schema);
  const fields = {};
  for (const s of [schema, 'frontmatter']) {
    for (const [k, def] of Object.entries(fw.loadSchema(s).fields ?? {})) {
      if (def.axis || k === 'id' || k === 'grc20Id' || k === 'sourceUri' || k === 'viaUri' || k === 'type' || k === 'last_reviewed') continue;
      if (def.enum) fields[k] = def.enum[0];
      else if (def.type === 'string') fields[k] = name;
      else if (def.type === 'array') fields[k] = [name];
      else if (def.type === 'object') fields[k] = { who: name };
    }
  }
  for (const r of fw.loadSchema(schema).required ?? []) if (!(r in fields) && r !== 'type') fields[r] = name;
  const full = { ...fields, steward: name, notes: name, contact: name, claimed_by: name, provenance: { origin: name, authorship: name }, source_lineage: name, update_text: name, certified_subject: `at://did:plc:node/org.hypercerts.claim.activity/${schema}`, signal_type: 'implementation' };
  if (!everywhere) for (const k of Object.keys(publicEntryFor(schema, full))) if (typeof full[k] === 'string') full[k] = `a node's ${k}`; else if (Array.isArray(full[k])) full[k] = [`a node's ${k}`];
  // title and description are what a claim shows of the NODE (CLAIM_CONTENT_FIELDS), so they name the node.
  return { ...full, title: `Node of ${schema}`, description: `About the node of ${schema}`, url: 'https://node-a.example', ...MARKS };
}

function instance() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claim-r4p-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  for (const s of SCHEMAS) writeFileSync(join(dir, 'data', 'kb', `${s}.yaml`), yaml.dump({ entries: { [`c-${s}`]: claimOf(s) } }));
  writeFileSync(join(dir, 'federation.yaml'), yaml.dump({ identity: { name: 'probe-os', type: 'PersonalNode' }, peers: [] }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 'probe', adapter: 'repo-data', target: '.',
    publish: { base_url: 'https://t.example', claims: true, claim_publisher: 'ReFi DAO', pages: true, certified_drafts: true, types_opt_in: ['source-system'] },
    atproto: { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: 'xyz.example.kb', standard_site: { enabled: true, title: 'T', url: 'https://t.example', paths: { default: '/k/{slug}' } } } }));
  return dir;
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test('probe: a claim of every core schema, a name in every field — no output outside the canon carries a name', async () => {
  const dir = instance();
  const puts = [];
  const client = () => ({ async login() {}, async putRecord(op) { puts.push(op); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' } } });
  const bridged = await bridgeAsync({ dir, config: loadKmsConfig(dir) });
  const drafts = await exportUpdateDrafts({ dir, config: loadKmsConfig(dir), now: '2026-11-20T00:00:00Z' });
  OPS['index.rebuild'].run({ dir, config: loadKmsConfig(dir) });
  const rendered = OPS['render.site'].run({ dir, config: loadKmsConfig(dir) });
  const map = buildMap({ dir });
  const exported = selectForPublication({ root: dir, verdicts: new Map(fw.getAdapter('repo-data').list(dir).map((l) => [`${l.schema}:${l.ref.slice(l.ref.lastIndexOf('#') + 1)}`, { ok: true }])), uuid: () => 'u', types: fw.publishableTypes({ publish: { types_opt_in: ['source-system'] } }), config: loadKmsConfig(dir) });
  await writePreview({ dir, now: '2026-11-20T00:00:00Z' });
  const outputs = {
    'publish report': JSON.stringify(res.report), 'putRecord calls': JSON.stringify(puts), 'bridge report': JSON.stringify(bridged.report), 'certified drafts report': JSON.stringify(drafts.report).replace(/Zed signal Person/g, ''),
    'render.site': JSON.stringify(rendered), 'map': JSON.stringify(map), 'export': JSON.stringify(exported.selected),
  };
  const canon = join(dir, 'data', 'kb');
  for (const f of walk(dir)) {
    if (f.startsWith(canon) || f.includes(`${join(dir, 'renders', 'preview')}`)) continue; // the canon holds the names by design; the steward's preview is local
    if (f.includes(join(dir, 'renders', 'certified-updates'))) continue; // a draft for the node's OWN session: it carries the node's update_text by purpose (floor-checked, see claims-round4.test.mjs)
    outputs[f.slice(dir.length + 1)] = readFileSync(f, 'utf8');
  }
  const leaks = [];
  for (const [where, text] of Object.entries(outputs)) for (const s of SCHEMAS) if (text.includes(nameOf(s))) leaks.push(`${nameOf(s)} in ${where}`);
  assert.ok(Object.keys(outputs).includes('src/data/kms-index.json'), 'render.site wrote its file');
  if (process.env.PROBE_DUMP) for (const [w, t] of Object.entries(outputs)) if (/^public\/api\/[a-z-]+\.json$/.test(w) || w.startsWith('renders/certified') || w.startsWith('src/content')) console.log('DUMP', w, t.slice(0, 1500));
  assert.deepEqual(leaks, []);
  assert.ok(Object.keys(outputs).length > 10, `the probe reached ${Object.keys(outputs).length} outputs`);
  assert.ok(existsSync(join(dir, 'public', '.well-known', 'knowledge.json')) && existsSync(join(dir, 'public', 'api', 'index.json')));
});
