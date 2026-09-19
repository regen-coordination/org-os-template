// demo/capture.mjs — runs every scenario against the real code and returns the facts the page is built from. Fail-closed: any scenario
// whose expectation is not met throws, so a page can never be built from a result the code did not produce.
import { packInfo } from './capture/pack-info.mjs';
import { publishMatrix } from './capture/publish-matrix.mjs';
import { oneProcess } from './capture/one-process.mjs';
import { attempts } from './capture/attempts.mjs';
import { territory } from './capture/territory.mjs';
import { federation } from './capture/federation.mjs';
import { verified } from './capture/verified.mjs';

export async function capture({ skipSuites = false } = {}) {
  const facts = {};
  facts.packInfo = packInfo();
  facts.matrix = await publishMatrix();
  facts.oneProcess = await oneProcess();
  facts.attempts = await attempts();
  facts.territory = territory();
  facts.federation = await federation();
  facts.verified = verified({ skipSuites });
  return { meta: { commit: facts.verified.head, node: process.version, capturedAt: new Date().toISOString() }, ...facts };
}
