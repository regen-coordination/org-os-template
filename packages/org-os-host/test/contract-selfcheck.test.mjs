import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHostDriverContract } from './contract.mjs';
import { assertDriver } from '../src/driver.mjs';

// A minimal in-memory driver that satisfies the contract, used to prove the suite
// itself is correct (green on a compliant driver).
function makeMemoryDriver() {
  return {
    resolveRemote: (id) => ({ scheme: id?.startsWith('rad:') ? 'radicle' : 'github', fetchUrl: id, canonical: true }),
    whoami: () => ({ id: 'github:tester' }),
    clone: async () => ({ ok: true, error: null }),
    fetchFile: async (_remote, path) => (path === 'federation.yaml' ? 'name: x' : null),
    listPeers: async () => [],
    getCanonical: async () => ({ defaultBranch: 'main', threshold: 1, delegates: [] }),
    getDrift: async () => ({ behind: 0, ahead: 0, canonicalRef: 'main' }),
    push: async () => ({ ok: true, error: null }),
    openChange: async () => ({ id: 'change-1', ok: true, error: null }),
    createIssue: async () => ({ id: 'issue-1', ok: true, error: null }),
    commentIssue: async () => ({ ok: true, error: null }),
    syncUpstream: async () => ({ ok: true, error: null }),
    webUrl: (_remote, path) => `https://example/${path}`,
  };
}

test('contract suite passes for a compliant in-memory driver', async () => {
  assertDriver(makeMemoryDriver(), 'memory');
  await runHostDriverContract(makeMemoryDriver, { assert });
});
