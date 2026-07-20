#!/usr/bin/env node
import { bootstrap } from './rad-bootstrap.mjs';

// Usage: rad-bootstrap <targetDir> --name <name> [--alias <a>] [--private|--public] [--seed <url>] [--github <h>]
function parseArgs(argv) {
  const [targetDir, ...rest] = argv;
  const opts = { targetDir, visibility: 'private' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--private') opts.visibility = 'private';
    else if (a === '--public') opts.visibility = 'public';
    else if (a === '--name') opts.name = rest[++i];
    else if (a === '--alias') opts.alias = rest[++i];
    else if (a === '--seed') opts.seed = rest[++i];
    else if (a === '--github') opts.github = rest[++i];
  }
  return opts;
}

export { parseArgs };

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.targetDir || !opts.name) {
    console.error('usage: rad-bootstrap <targetDir> --name <name> [--alias <a>] [--private|--public] [--seed <url>] [--github <h>]');
    process.exit(2);
  }
  bootstrap(opts).then((r) => {
    console.log(`✓ bootstrapped ${opts.name}\n  RID: ${r.rid}\n  DID: ${r.did}\n  visibility: ${r.visibility}`);
  }).catch((e) => { console.error(`bootstrap failed: ${e.message}`); process.exit(1); });
}
