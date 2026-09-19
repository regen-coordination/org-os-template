// demo/capture/env.mjs — shared plumbing for the capture scenarios: the REAL kms/framework imports, per-scenario registry reset,
// fail-closed expectations, temp-dir instances and a fake PDS client. Nothing here touches the network or writes outside temp dirs.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as fw from '../../../org-os-kms/src/framework.mjs';
import { OPS } from '../../../org-os-kms/src/ops.mjs';
import { resetRegistryBindings, registryBindings } from '../../../org-os-kms/src/bind.mjs';
import { loadExtensions, loadPackConnectors } from '../../../org-os-kms/src/extensions.mjs';
import { mergeConnectors } from '../../../org-os-kms/src/connectors/index.mjs';
import { createAtprotoConnector } from '../../../org-os-kms/src/atproto/connector.mjs';
import { validateKernel } from '../../../toolkit-framework/src/index.mjs';
import { INSTANCE_DATA } from '../sample.mjs';

export { fw, OPS, registryBindings, loadExtensions, loadPackConnectors, mergeConnectors, createAtprotoConnector, validateKernel, yaml };
export const AUTH = 'cat.regenerant.kb';
export const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PACK_TYPES = ['territorial-unit', 'data-stream'];
export const ENV = { ATPROTO_APP_PASSWORD: 'fake-not-a-secret' };

export const reset = () => { fw.resetPacks(); resetRegistryBindings(); };
export function expect(cond, msg) { if (!cond) throw new Error(`demo capture: ${msg}`); }
export const temp = (prefix) => mkdtempSync(join(tmpdir(), `demo-${prefix}-`));
export const tree = (root, rel = '') => readdirSync(join(root, rel), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? tree(root, join(rel, e.name)) : [join(rel, e.name)]).sort();

export const fakeClient = (log) => () => ({
  async login() { return { did: 'did:plc:demo' }; },
  async putRecord(op) { log.push(op); return { uri: `at://did:plc:demo/${op.collection}/${op.rkey}`, cid: 'cid-demo' }; },
  async deleteRecord() {},
});

/** A temp instance: the same sample data in every scenario, only the kms.yaml differs (packs, opt-in). */
export function makeInstance({ extensions = null, optIn = [], data = INSTANCE_DATA } = {}) {
  const dir = temp('inst');
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  for (const [schema, entries] of Object.entries(data)) writeFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 'demo', adapter: 'repo-data', target: '.',
    ...(extensions ? { extensions } : {}),
    publish: { base_url: 'https://demo.invalid', ...(optIn.length ? { types_opt_in: optIn } : {}) },
    atproto: { did: 'did:plc:demo', handle: 'demo.invalid', pds: 'https://pds.invalid', nsid_authority: AUTH } }));
  return dir;
}

/** The real publish op, applied to the fake PDS. A thrown error is data (the page shows it), never swallowed. */
export async function runPublish(dir) {
  const log = [];
  try {
    const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: fakeClient(log), env: ENV } });
    return { ok: res.ok, error: null, log, report: res.report };
  } catch (e) { return { ok: false, error: e.message, log, report: null }; }
}

export const contextPackTypes = (dir) => Object.keys(JSON.parse(readFileSync(join(dir, 'public', 'api', 'context.jsonld'), 'utf8'))['@context']).filter((k) => PACK_TYPES.includes(k));
