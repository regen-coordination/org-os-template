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
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import yaml from 'js-yaml';

import { CANONICAL_MACHINERY, localScriptTargets } from './checks/machinery.mjs';
import { personalMarkers } from './checks/agent-layer.mjs';

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

// ── the agent layer (DAO-OS L6 §14, Q76) ────────────────────────────────────────────────────────────

/** The agent layer's files (L6 §3.1; packages/admin/lib/workspace/targets.mjs keeps the same list). */
const AGENT_LAYER = /^(?:memory\/|docs\/plans\/|docs\/agent-plans\/|MEMORY\.md$|HEARTBEAT\.md$)/;
const AGENT_ROOTS = ['memory', 'docs/plans', 'docs/agent-plans', 'MEMORY.md', 'HEARTBEAT.md'];
/** A file past this is not read whole for markers: it is listed as not read. */
const AGENT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Every file under `rel` on disk (links are not followed), as /-separated paths from `root`. */
function filesUnder(root, rel) {
  const full = path.join(root, rel);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    return [];
  }
  if (st.isFile()) return [rel];
  if (!st.isDirectory()) return [];
  let entries;
  try {
    entries = readdirSync(full);
  } catch {
    return [];
  }
  return entries.flatMap((name) => filesUnder(root, `${rel}/${name}`));
}

/** The agent-layer files git holds or would take (tracked, or untracked and not ignored); every one on disk when the
 *  folder is no repository. A file git ignores is not in git, so it is not at members. */
function agentLayerPaths(root, isRepo) {
  if (isRepo) {
    const out = gitOut(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...AGENT_ROOTS]);
    if (out !== null) {
      return [...new Set(out.split('\0').filter((p) => p !== '' && AGENT_LAYER.test(p) && existsSync(path.join(root, p))))].sort();
    }
  }
  return AGENT_ROOTS.flatMap((rel) => filesUnder(root, rel)).filter((p) => AGENT_LAYER.test(p)).sort();
}

/** The names data/members.yaml lists: what a file's text is searched for (never kept beside its counts). */
function memberNames(root) {
  const doc = readYaml(path.join(root, 'data', 'members.yaml'));
  const list = Array.isArray(doc?.members) ? doc.members : [];
  return list.map((m) => (m && typeof m.name === 'string' ? m.name : null)).filter(Boolean);
}

/** Each agent-layer file with its level and its personal-data markers, as counts: the texts are read and let go. */
function readAgentLayer(root, isRepo) {
  const names = memberNames(root);
  return agentLayerPaths(root, isRepo).map((rel) => {
    let markers = null;
    try {
      const full = path.join(root, rel);
      if (statSync(full).size <= AGENT_FILE_MAX_BYTES) markers = personalMarkers(readFileSync(full, 'utf-8'), names);
    } catch {
      markers = null;
    }
    return { path: rel, level: 'members', markers };
  });
}

/** The private store's file as the Hub finds it (packages/admin/server/private/paths.ts): `ORG_OS_PRIVATE_DIR` (from
 *  the instance's root when relative), else `<root>/.org-os/private`; `house.db` in it. */
function storeFile(root, env) {
  const set = env.ORG_OS_PRIVATE_DIR;
  const dir = set !== undefined && String(set).trim() !== '' ? path.resolve(root, String(set)) : path.join(root, '.org-os', 'private');
  return path.join(dir, 'house.db');
}

/** The real path, where there is one. */
function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The environment the target's store is looked for under (Task 15 review M-4). In hub mode (`--dir` naming an instance
 * the current directory is not inside), an absolute `ORG_OS_PRIVATE_DIR` is the shell's setting for the instance it was
 * set up for, never the target's: it is left out, so the target's own place is read (a relative one is read from the
 * target's root, as that instance's Hub reads it). From inside the instance, the environment stands as it is.
 */
export function storeEnvFor(env, dir, cwd) {
  const set = env.ORG_OS_PRIVATE_DIR;
  if (set === undefined || String(set).trim() === '' || !path.isAbsolute(String(set))) return env;
  const rel = path.relative(real(dir), real(cwd));
  if (rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) return env;
  const { ORG_OS_PRIVATE_DIR: _shells, ...rest } = env;
  return rest;
}

/** How many Council memory entries the store holds (L6 §14): a count, read read-only; null when there is no store, or
 *  it cannot be read. Nothing is created, and no title is read. */
function readCouncilMemory(root, env) {
  const file = storeFile(root, env);
  if (!existsSync(file)) return null;
  let db = null;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT count(*) AS n FROM records WHERE collection = ?').get('council-memory');
    return Number(row?.n ?? 0);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* closing what failed to open */
    }
  }
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
 * @param {boolean} [opts.beforeWidening=false]  membership is about to widen (Q67): the agent layer's markers block
 * @param {object} [opts.env]          where the private store is looked for (ORG_OS_PRIVATE_DIR); default process.env
 */
export function readInstance(dir, { frameworkDir, runValidators = true, now = Date.now(), beforeWidening = false, env = process.env } = {}) {
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
  const git = readGit(root);
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

    git,
    commitsBehindFramework: commitsBehind(fw, federation?.metadata?.last_sync_commit),

    memoryLatestISO,
    syncReceipts,

    agentLayer: readAgentLayer(root, git.isRepo),
    councilMemory: readCouncilMemory(root, env),
    beforeWidening: Boolean(beforeWidening),

    validators: runValidators
      ? {
          structure: runValidator(fw, path.join('scripts', 'validate-structure.mjs'), root),
          schemas: runValidator(fw, path.join('scripts', 'validate-identity.mjs'), root),
          data: runValidator(fw, path.join('scripts', 'validate-data.mjs'), root),
          governance: runValidator(fw, path.join('scripts', 'validate-governance.mjs'), root),
        }
      : {
          structure: { ran: false, reason: 'skipped (--no-validators)' },
          schemas: { ran: false, reason: 'skipped (--no-validators)' },
          data: { ran: false, reason: 'skipped (--no-validators)' },
          governance: { ran: false, reason: 'skipped (--no-validators)' },
        },

    framework: {
      dir: fw,
      version: frameworkPkg?.version ?? null,
      headSha: gitOut(fw, ['rev-parse', 'HEAD']),
    },
  };
}
