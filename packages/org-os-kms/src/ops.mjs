// src/ops.mjs
// The OP REGISTRY: maps declarative op-names (from bind.mjs LIFECYCLE_BINDINGS) to either
// an executable thunk over the framework API (kind:'exec') or an agent skill directive
// (kind:'skill'). This is what makes the declarative lifecycle actually run, without
// reimplementing any framework logic. `write:true` marks ops whose failure must stop the
// run (fail-hard); reads/renders are fail-soft.
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as fw from './framework.mjs';
import { loadKmsConfig } from './config.mjs';
import { bridge } from './registry-bridge.mjs';
import { renderDashboardSection, renderSiteData } from './render.mjs';
import { checkPeers } from './federate.mjs';
import { ensureIds } from './identity.mjs';
import { readManifest, writeManifest } from './manifest.mjs';
import { planPublish, applyPublish } from './atproto/publish.mjs';
import { createClient as defaultCreateClient } from './atproto/client.mjs';
import { writeStaticSurface } from './static/surface.mjs';
import { loadInstanceGate, buildGateContext, applyGate } from './gate.mjs';
import { getConnector, CONNECTORS } from './connectors/index.mjs';

export const OPS = {
  // write:true here = CRITICAL/fail-hard: if kms.yaml can't load, no downstream op can run.
  'config.load': { kind: 'exec', write: true, run: (ctx) => {
    ctx.config = loadKmsConfig(ctx.dir);
    return { ok: true, report: { instance: ctx.config.instance } };
  } },

  'index.rebuild': { kind: 'exec', write: false, run: (ctx) => {
    const a = fw.getAdapter(ctx.config.adapter);
    const t = join(ctx.dir, ctx.config.target);
    const written = a.writeIndex(t);
    ctx.index = a.index(t);
    return { ok: true, report: { total: ctx.index.total, ...written } };
  } },

  'review.list': { kind: 'exec', write: false, run: (ctx) => {
    ctx.review = fw.reviewQueue({ adapter: ctx.config.adapter, target: join(ctx.dir, ctx.config.target) });
    return { ok: true, report: { awaiting: ctx.review.length } };
  } },

  'render.dashboard': { kind: 'exec', write: false, run: (ctx) => {
    ctx.dashboardSection = renderDashboardSection(ctx.index || {});
    return { ok: true };
  } },

  'render.site': { kind: 'exec', write: false, run: (ctx) => {
    return renderSiteData({ dir: ctx.dir, target: ctx.config.target,
      outPath: (ctx.config.render && ctx.config.render.site_data) || 'src/data/kms-index.json' });
  } },

  'bridge': { kind: 'exec', write: true, run: (ctx) => bridge(ctx) },

  'federate.check': { kind: 'exec', write: false, run: (ctx) => checkPeers(ctx) },

  'sync.push': { kind: 'exec', write: true, run: () => (
    { ok: true, report: { draft: true, note: 'git add/commit/push — draft-and-present, run after review' } }
  ) },

  // publish: plan mode by default (what `close` runs); real PDS writes only with --apply
  // (flags.apply) or publish.apply:true in kms.yaml. Framework gate is the floor; the
  // instance gate can only narrow. Manifest is written only when applyPublish ran (right after it).
  'publish': { kind: 'exec', write: true, run: async (ctx) => {
    const dir = ctx.dir || '.';
    const config = ctx.config || (ctx.config = loadKmsConfig(dir));
    const deps = { createClient: defaultCreateClient, env: process.env, ...(ctx.deps || {}) };
    const dry = ctx.flags?.dry === true;
    const apply = ctx.flags?.apply === true || config.publish?.apply === true;
    const target = join(dir, config.target);
    const adapter = fw.getAdapter(config.adapter);
    const report = { dry, atproto: { status: 'not-configured' }, static: null };

    const all = adapter.list(target);
    const types = fw.publishableTypes(config);
    let candidates = all.filter(({ schema, object }) => fw.isPublishable(object, { schema, types }));
    const gate = await loadInstanceGate(dir, config);
    if (gate) {
      const { passed, rejected } = applyGate(gate, candidates, buildGateContext(all));
      candidates = passed;
      const by_reason = {}; for (const r of rejected) by_reason[r.reason] = (by_reason[r.reason] || 0) + 1;
      report.gate = { passed: passed.length, rejected: rejected.length, by_reason };
    }
    // Mint ids to disk only when something will consume them (a PDS or the static surface); otherwise
    // an instance with nowhere to publish would get tracked yaml rewritten on every close. The preview
    // (in-memory ids, report.minted) is unchanged.
    const at = config.atproto;
    const hasTarget = Boolean(at?.did && at?.pds && at?.nsid_authority) || config.publish?.static !== false;
    const { minted, items } = ensureIds({ adapter: config.adapter, target, items: candidates, write: !dry && hasTarget, mintGeo: Boolean(config.geo?.space) });
    report.minted = minted.length;

    const manifest = readManifest(dir);
    let next = manifest;
    if (at?.did && at?.pds && at?.nsid_authority) {
      const plan = planPublish({ items, manifest, did: at.did, authority: at.nsid_authority });
      if (!plan.ok) return { ok: false, report: { ...report, errors: plan.errors } };
      const counts = { created: plan.create.length, updated: plan.update.length, deleted: plan.delete.length, skipped: plan.skip.length };
      const password = deps.env.ATPROTO_APP_PASSWORD;
      if (!password) report.atproto = { status: 'not-configured', reason: 'ATPROTO_APP_PASSWORD not set', ...counts };
      else if (dry || !apply) report.atproto = { status: 'planned', ...counts };
      else if (items.length === 0 && plan.delete.length > 0) {
        // Never let an unattended apply (close + publish.apply:true) turn an empty/misconfigured selection into a mass delete.
        return { ok: false, report: { ...report, atproto: { status: 'failed', reason: 'refusing to delete every published record: no publishable items were selected (check publish.gate, types_opt_in/out, target and public_use)', deleted: 0, wouldDelete: plan.delete.length } } };
      } else {
        const client = deps.createClient({ pds: at.pds });
        await client.login({ identifier: at.handle || at.did, password });
        const applied = await applyPublish(plan, { client, did: at.did });
        next = applied.manifest;
        writeManifest(dir, next); // authoritative record of what is on the PDS: persist before anything that can throw
        report.atproto = { status: applied.failures.length ? 'failed' : 'applied', ...applied.applied, skipped: plan.skip.length, failures: applied.failures };
      }
    }
    if (config.publish?.static === false) report.static = 'disabled';
    else if (!dry) {
      try { report.static = writeStaticSurface({ dir, outDir: config.publish?.static_dir || 'public', items, allItems: all, manifest: next, config }); }
      catch (e) { report.static = { status: 'failed', error: e.message }; }
    }
    else report.static = 'skipped (dry)';
    return { ok: report.atproto.status !== 'failed' && report.static?.status !== 'failed', report };
  } },

  // ingest.pull: CLI verb only (`org-os-kms ingest`), deliberately NOT bound to any lifecycle event.
  // Fail-soft per connector: a failure is reported (status:'failed', report.failed) and the op still
  // returns ok:true so one bad peer never blocks the rest. --dry stores nothing and never writes a cursor.
  // kms.yaml is rewritten only when a cursor actually changed (yaml.dump drops the file's comments).
  'ingest.pull': { kind: 'exec', write: true, run: async (ctx) => {
    const dir = ctx.dir || '.';
    const config = ctx.config || (ctx.config = loadKmsConfig(dir));
    const registry = ctx.deps?.registry || CONNECTORS;
    const dry = ctx.flags?.dry === true;
    const only = ctx.flags?.connector;
    // A bare `--connector` (parsed as true) or an empty value must never silently widen the run to every connector.
    if (ctx.flags && 'connector' in ctx.flags && only !== undefined && (typeof only !== 'string' || !only.trim())) {
      return { ok: false, report: { connectors: [], failed: 0, error: '--connector needs a name (usage: --connector <name>)' } };
    }
    const target = join(dir, config.target);
    const declared = config.connectors || [];
    if (typeof only === 'string' && !declared.some((d) => d.name === only)) {
      return { ok: true, report: { connectors: [], failed: 0, warning: `no declared connector named ${only}` } };
    }
    const shared = { self: config.atproto?.did, nsid_authority: config.atproto?.nsid_authority, pds: config.atproto?.pds };
    const report = { connectors: [], failed: 0 };
    const kmsPath = join(dir, 'kms.yaml');
    const raw = yaml.load(readFileSync(kmsPath, 'utf8'));
    const normalize = (c) => (c == null || (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0)) ? null : c;
    let cursorChanged = false;
    for (let i = 0; i < declared.length; i++) {
      const decl = declared[i];
      if (typeof only === 'string' && decl.name !== only) continue;
      try {
        const r = await fw.runConnector(getConnector(decl.name, registry), { config: { ...shared, ...(decl.config || {}) }, cursor: decl.cursor ?? null, adapter: config.adapter, target, dry });
        if (!dry && JSON.stringify(normalize(r.cursor)) !== JSON.stringify(normalize(decl.cursor))) {
          raw.connectors[i].cursor = r.cursor ?? null;
          cursorChanged = true;
        }
        report.connectors.push({ name: decl.name, status: 'ok', dry: r.dry, pulled: r.pulled, candidates: r.candidates, stored: r.stored, updated: r.updated,
          collisions: r.collisions, collided: r.collided ?? [], invalid: r.invalid ?? [], retractions: r.retractions, errors: r.errors });
      } catch (e) {
        if (e.code === 'NOT_IMPLEMENTED') report.connectors.push({ name: decl.name, status: 'not-implemented' });
        else { report.failed++; report.connectors.push({ name: decl.name, status: 'failed', error: e.message }); }
      }
    }
    if (!dry && cursorChanged) writeFileSync(kmsPath, yaml.dump(raw, { lineWidth: 120 }));
    return { ok: true, report };
  } },

  // skill directives — judgment ops the agent runs; the executor collects them.
  'csis-review': { kind: 'skill', skill: 'csis-review' },
  'emit-contributions': { kind: 'skill', skill: 'register-source' },
};
