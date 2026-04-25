#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

function parseArgs(argv) {
  const args = { framework: null, target: '.', prune: false, check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--framework') args.framework = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--prune') args.prune = true;
    else if (a === '--check') args.check = true;
  }
  if (!args.framework) args.framework = path.resolve(args.target, '../org-os');
  return args;
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function rmDirSync(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

const args = parseArgs(process.argv);
const fedPath = path.join(args.target, 'federation.yaml');
if (!fs.existsSync(fedPath)) {
  console.error(`sync-packages: ${fedPath} not found`);
  process.exit(1);
}
const fed = yaml.load(fs.readFileSync(fedPath, 'utf-8'));
const toggles = fed.packages || {};

// Validate toggle shape: each value must be a boolean
for (const [pkgId, val] of Object.entries(toggles)) {
  if (typeof val !== 'boolean') {
    console.error(`sync-packages: federation.yaml packages.${pkgId} must be boolean (true/false), got ${typeof val}: ${JSON.stringify(val)}`);
    process.exit(1);
  }
}

const fwPkgs = path.join(args.framework, 'packages');
if (!fs.existsSync(fwPkgs)) {
  console.error(`sync-packages: framework packages/ dir not found at ${fwPkgs}`);
  process.exit(1);
}

let exitCode = 0;
for (const [pkgId, enabled] of Object.entries(toggles)) {
  const src = path.join(fwPkgs, pkgId);
  const dst = path.join(args.target, 'packages', pkgId);
  const presentLocally = fs.existsSync(dst);

  if (enabled) {
    if (!fs.existsSync(src)) {
      console.error(`sync-packages: enabled package "${pkgId}" not found in framework at ${src}`);
      exitCode = 1;
      continue;
    }
    if (args.check) {
      console.log(`[check] ${pkgId}: would sync (enabled)`);
      continue;
    }
    if (presentLocally) {
      console.log(`[sync] ${pkgId}: replacing local copy at ${dst}`);
    }
    rmDirSync(dst);
    copyDirSync(src, dst);
    console.log(`[sync] ${pkgId}: ${src} → ${dst}`);
  } else {
    if (presentLocally) {
      if (args.prune) {
        if (args.check) {
          console.log(`[check] ${pkgId}: would prune (disabled, present)`);
          continue;
        }
        rmDirSync(dst);
        console.log(`[prune] ${pkgId}: removed`);
      } else {
        console.log(`[warn] ${pkgId}: disabled but present locally; use --prune to remove`);
      }
    }
  }
}

process.exit(exitCode);
