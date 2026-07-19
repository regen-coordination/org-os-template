// src/ops.mjs
// The OP REGISTRY: maps declarative op-names (from bind.mjs LIFECYCLE_BINDINGS) to either
// an executable thunk over the framework API (kind:'exec') or an agent skill directive
// (kind:'skill'). This is what makes the declarative lifecycle actually run, without
// reimplementing any framework logic. `write:true` marks ops whose failure must stop the
// run (fail-hard); reads/renders are fail-soft.
import { join } from 'node:path';
import * as fw from './framework.mjs';
import { loadKmsConfig, persistConnectorCursors } from './config.mjs';
import { getConnector as defaultGetConnector } from './connectors/index.mjs';
import { bridge } from './registry-bridge.mjs';
import { renderDashboardSection, renderSiteData } from './render.mjs';
import { checkPeers } from './federate.mjs';

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

  // Pull knowledge from declared connectors into the KB. write:true → fail-hard on a real
  // error; a stub's NOT_IMPLEMENTED is reported+skipped so it never aborts a live connector.
  'ingest.pull': { kind: 'exec', write: true, run: async (ctx) => {
    const getConn = ctx.getConnector || defaultGetConnector;
    const adapter = ctx.getAdapter ? ctx.getAdapter(ctx.config.adapter) : fw.getAdapter(ctx.config.adapter);
    const persist = ctx.persistCursors || persistConnectorCursors;
    const target = ctx.config.target === '.' ? ctx.dir : join(ctx.dir, ctx.config.target);
    const connectors = ctx.config.connectors || [];
    const report = { pulled: [], errors: [] };
    for (const decl of connectors) {
      try {
        const conn = getConn(decl.name);
        const res = await fw.runConnector(conn, { config: decl.config || {}, cursor: decl.cursor ?? null, adapter, target });
        decl.cursor = res.cursor;
        report.pulled.push({ name: decl.name, stored: res.stored, candidates: res.candidates, errors: res.errors });
        if (res.errors.length) report.errors.push(...res.errors.map((e) => `${decl.name}: ${e}`));
      } catch (e) {
        if (/NOT_IMPLEMENTED/.test(e.message)) { report.pulled.push({ name: decl.name, skipped: 'NOT_IMPLEMENTED' }); continue; }
        report.errors.push(`${decl.name}: ${e.message}`);
      }
    }
    persist(ctx.dir, connectors);
    return { ok: report.errors.length === 0, report };
  } },

  'bridge': { kind: 'exec', write: true, run: (ctx) => bridge(ctx) },

  'federate.check': { kind: 'exec', write: false, run: (ctx) => checkPeers(ctx) },

  'sync.push': { kind: 'exec', write: true, run: () => (
    { ok: true, report: { draft: true, note: 'git add/commit/push — draft-and-present, run after review' } }
  ) },

  // skill directives — judgment ops the agent runs; the executor collects them.
  'csis-review': { kind: 'skill', skill: 'csis-review' },
  'emit-contributions': { kind: 'skill', skill: 'register-source' },
};
