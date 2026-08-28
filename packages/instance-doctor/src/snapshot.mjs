/**
 * snapshot.mjs — the only part of instance-doctor that touches the filesystem.
 *
 * Reads everything the six checks need in one pass and hands back a plain
 * object. Keeping I/O here is what lets every check be a pure function with
 * plain-object fixtures, and it is also what makes the hub mode possible: the
 * doctor reads a *sibling* directory using the FRAMEWORK's own validators and
 * machinery, never the instance's — instances carry missing or skewed copies,
 * which is the whole defect class this package exists to find.
 *
 * Nothing here throws on a malformed instance. A broken instance is the normal
 * input; refusing to read it would defeat the purpose.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { CANONICAL_MACHINERY, localScriptTargets } from './checks/machinery.mjs';

const RECEIPT_RE = /^sync-(receipt-)?\d{4}-\d{2}-\d{2}\.md$/;
const MEMORY_DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function readText(file) {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const raw = readText(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readYaml(file) {
  const raw = readText(file);
  if (raw === null) return null;
  try {
    return yaml.load(raw) ?? null;
  } catch {
    return null;
  }
}

function md5(file) {
  try {
    return createHash('md5').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readGit(dir) {
  const top = gitOut(dir, ['rev-parse', '--show-toplevel']);
  if (top === null) return { isRepo: false, remotes: {}, lastCommitISO: null, dirtyCount: 0, headSha: null };

  const remotes = {};
  const remoteNames = (gitOut(dir, ['remote']) || '').split('\n').filter(Boolean);
  for (const name of remoteNames) {
    const url = gitOut(dir, ['remote', 'get-url', name]);
    if (url) remotes[name] = url;
  }

  const status = gitOut(dir, ['status', '--porcelain']);
  return {
    isRepo: true,
    toplevel: top,
    remotes,
    headSha: gitOut(dir, ['rev-parse', 'HEAD']),
    lastCommitISO: gitOut(dir, ['log', '-1', '--format=%cI']),
    dirtyCount: status ? status.split('\n').filter(Boolean).length : 0,
  };
}

/** Newest `memory/YYYY-MM-DD.md`, as an ISO date, plus every sync receipt. */
function readMemory(dir) {
  const memoryDir = path.join(dir, 'memory');
  let latest = null;
  const receipts = [];

  const scan = (subdir, prefix) => {
    if (!existsSync(subdir)) return;
    let entries;
    try {
      entries = readdirSync(subdir);
    } catch {
      return;
    }
    for (const name of entries) {
      const dated = MEMORY_DATE_RE.exec(name);
      if (dated && (!latest || dated[1] > latest)) latest = dated[1];
      if (RECEIPT_RE.test(name)) receipts.push(path.join(prefix, name));
    }
  };

  scan(memoryDir, 'memory');
  scan(path.join(memoryDir, 'reports'), path.join('memory', 'reports'));

  return {
    memoryLatestISO: latest ? `${latest}T00:00:00Z` : null,
    syncReceipts: receipts.sort(),
  };
}

/**
 * Run one of the framework's validators against the target directory and
 * summarise the result. Never throws: a validator that cannot run is reported
 * as `ran: false` rather than silently counted as a pass.
 */
function runValidator(frameworkDir, script, targetDir) {
  const scriptPath = path.join(frameworkDir, script);
  if (!existsSync(scriptPath)) {
    return { ran: false, reason: `${script} not present in the framework checkout` };
  }
  const r = spawnSync('node', [scriptPath, targetDir], {
    cwd: frameworkDir,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  if (r.error) return { ran: false, reason: r.error.message };

  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = /Results:\s*(\d+)\s+passed,\s*(\d+)\s+failed,\s*(\d+)\s+warning/.exec(out);
  const tail = out.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
  return {
    ran: true,
    exitCode: r.status ?? 1,
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
    warnings: m ? Number(m[3]) : 0,
    tail,
  };
}

/** How far the framework has moved since the instance last synced. */
function commitsBehind(frameworkDir, lastSyncCommit) {
  if (!lastSyncCommit || !/^[0-9a-f]{40}$/i.test(String(lastSyncCommit))) return null;
  const head = gitOut(frameworkDir, ['rev-parse', 'HEAD']);
  if (!head) return null;
  // If the recorded commit is not in this checkout, rev-list fails and gitOut
  // returns null — which is the honest answer: the distance is unknown.
  const count = gitOut(frameworkDir, ['rev-list', '--count', `${lastSyncCommit}..${head}`]);
  return count === null ? null : Number(count);
}

/**
 * @param {string} dir       instance directory to assess
 * @param {object} opts
 * @param {string} opts.frameworkDir  the org-os framework checkout to assess against
 * @param {boolean} [opts.runValidators=true]
 * @param {number} [opts.now]          injected clock, for deterministic tests
 */
export function readInstance(dir, { frameworkDir, runValidators = true, now = Date.now() } = {}) {
  const root = path.resolve(dir);
  const fw = path.resolve(frameworkDir);

  const packageJsonRaw = readText(path.join(root, 'package.json'));
  let packageJson = null;
  try {
    packageJson = packageJsonRaw === null ? null : JSON.parse(packageJsonRaw);
  } catch {
    packageJson = null;
  }

  const federation = readYaml(path.join(root, 'federation.yaml'));

  // The framework-only registry plus the template package name identify the
  // framework checkout itself; no instance carries both.
  const isFramework =
    existsSync(path.join(root, 'data', 'instances.yaml')) &&
    packageJson?.name === 'organizational-os-template';

  const scriptFiles = {};
  for (const target of localScriptTargets(packageJson)) {
    const full = path.join(root, target.file);
    if (!existsSync(full)) {
      scriptFiles[target.file] = { exists: false };
      continue;
    }
    let size = null;
    try {
      size = statSync(full).size;
    } catch {
      size = null;
    }
    scriptFiles[target.file] = { exists: true, size, content: readText(full) };
  }

  const machinery = {};
  for (const rel of CANONICAL_MACHINERY) {
    machinery[rel] = {
      instanceMd5: md5(path.join(root, rel)),
      frameworkMd5: md5(path.join(fw, rel)),
    };
  }

  const { memoryLatestISO, syncReceipts } = readMemory(root);
  const frameworkPkg = readJson(path.join(fw, 'package.json'));

  return {
    dir: root,
    name: federation?.identity?.name ?? packageJson?.name ?? path.basename(root),
    now,
    isFramework,

    identityMd: readText(path.join(root, 'IDENTITY.md')),
    federation,
    packageJson,
    packageJsonRaw,
    daoJson: readJson(path.join(root, '.well-known', 'dao.json')),
    versionMd: readText(path.join(root, 'VERSION.md')),
    changelog: readText(path.join(root, 'CHANGELOG.md')),

    scriptFiles,
    machinery,
    dirs: { migrations: existsSync(path.join(root, 'migrations')) },

    git: readGit(root),
    commitsBehindFramework: commitsBehind(fw, federation?.metadata?.last_sync_commit),

    memoryLatestISO,
    syncReceipts,

    validators: runValidators
      ? {
          structure: runValidator(fw, path.join('scripts', 'validate-structure.mjs'), root),
          schemas: runValidator(fw, path.join('scripts', 'validate-identity.mjs'), root),
        }
      : {
          structure: { ran: false, reason: 'skipped (--no-validators)' },
          schemas: { ran: false, reason: 'skipped (--no-validators)' },
        },

    framework: {
      dir: fw,
      version: frameworkPkg?.version ?? null,
      headSha: gitOut(fw, ['rev-parse', 'HEAD']),
    },
  };
}
