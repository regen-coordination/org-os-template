#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

console.log('[sync-upstream] Pulling framework updates ...');
// Future: pull from framework repo (git fetch + apply). v3.5: just delegates to sync-packages.

console.log('[sync-upstream] Syncing packages ...');
const result = spawnSync('node', ['scripts/sync-packages.mjs', ...process.argv.slice(2)], {
  stdio: 'inherit'
});
process.exit(result.status || 0);
