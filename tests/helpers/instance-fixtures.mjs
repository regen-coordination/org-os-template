// tests/helpers/instance-fixtures.mjs
//
// Builders for throwaway on-disk instances. Named *.mjs, not *.test.mjs, so
// the tests/**/*.test.mjs glob does not try to run it as a suite.
//
// The six shapes below are the real failure signatures the 2026-08-28 sweep
// recorded across the fleet; instance-doctor's on-disk tests assert against
// them so a regression shows up as "refi-med-os would no longer be caught"
// rather than as an abstract diff.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).trim();
}

/**
 * Write a minimal instance tree.
 *
 * @param {object} opts
 * @param {string} [opts.name]             identity name used across surfaces
 * @param {string} [opts.pkgName]          package.json name
 * @param {string} [opts.frameworkVersion] federation.yaml metadata.framework_version
 * @param {object} [opts.metadataExtra]    extra federation.yaml metadata lines
 * @param {object} [opts.scripts]          package.json scripts
 * @param {object} [opts.files]            extra files, path → contents
 * @param {string} [opts.daoName]          .well-known/dao.json name (null to omit the file)
 * @param {boolean} [opts.initGit]         run git init + an initial commit
 * @param {object} [opts.remotes]          remote name → url
 */
export function makeInstance(opts = {}) {
  const {
    name = 'Acme Co',
    pkgName = 'acme-os',
    frameworkVersion = '0.5',
    metadataExtra = {},
    scripts = {},
    files = {},
    daoName = name,
    initGit = true,
    remotes = {},
    type = 'Cooperative',
  } = opts;

  const dir = mkdtempSync(path.join(tmpdir(), 'doctor-instance-'));

  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '0.1.0', type: 'module', scripts }, null, 2),
  );

  const metaLines = Object.entries({ framework_version: `"${frameworkVersion}"`, ...metadataExtra })
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  writeFileSync(
    path.join(dir, 'federation.yaml'),
    `identity:\n  name: "${name}"\n  type: "${type}"\nmetadata:\n${metaLines}\n`,
  );

  writeFileSync(path.join(dir, 'IDENTITY.md'), `# IDENTITY.md\n\n- **Name:** ${name}\n- **Type:** ${type}\n`);

  if (daoName !== null) {
    mkdirSync(path.join(dir, '.well-known'), { recursive: true });
    writeFileSync(
      path.join(dir, '.well-known', 'dao.json'),
      JSON.stringify({ '@context': 'https://daostar.org/schemas', name: daoName }, null, 2),
    );
  }

  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  if (initGit) {
    git(dir, ['init', '--quiet', '--initial-branch=main']);
    git(dir, ['add', '.']);
    git(dir, ['commit', '--quiet', '-m', 'fixture: initial']);
    for (const [remote, url] of Object.entries(remotes)) {
      git(dir, ['remote', 'add', remote, url]);
    }
  }

  return dir;
}

export const CANONICAL_UPSTREAM = 'https://github.com/regen-coordination/org-os-template.git';

/** refi-med-os: pristine 3.0 scaffold, no machinery, upstream → legacy repo. */
export const refiMedShape = () => ({
  name: 'ReFi Mediterranean',
  pkgName: 'refi-med-os',
  type: 'LocalNode',
  frameworkVersion: '3.0',
  metadataExtra: { scaffolded_from: '"regen-coordination/organizational-os-framework@3.0"' },
  scripts: {},
  remotes: {
    origin: 'https://github.com/ReFiDAO/refi-med-os.git',
    upstream: 'https://github.com/regen-coordination/organizational-os-framework.git',
  },
});

/** bread-coop-os: genesis-stamped, no remote at all, dao.json says "org-os". */
export const breadCoopShape = () => ({
  name: 'bread-coop-os',
  pkgName: 'bread-coop-os',
  frameworkVersion: '3.5',
  metadataExtra: {
    genesis_commit: '"af8941a273a7588a8ba20209671ba26236c5549a"',
    last_sync_commit: 'null',
  },
  daoName: 'org-os',
  remotes: {},
});

/** refi-dao-os: 178-byte no-op sync stub, no upstream remote, VERSION.md 1.0.0. */
export const refiDaoShape = () => ({
  name: 'ReFi DAO',
  pkgName: 'refi-dao-os',
  type: 'DAO',
  frameworkVersion: '3.0',
  scripts: { 'sync:upstream': 'node scripts/sync-upstream.mjs' },
  files: {
    'scripts/sync-upstream.mjs':
      "#!/usr/bin/env node\n\nconsole.log('sync:upstream: manual workflow for refi-dao-os');\nconsole.log('Use git remotes and review changes before applying upstream template updates.');\n",
    'VERSION.md': '# VERSION.md\n\n**Framework Version:** `1.0.0`\n',
  },
  remotes: { origin: 'https://github.com/ReFiDAO/refi-dao-os.git' },
});

/** regen-coordination-os: template-named package, duplicate scripts key. */
export const regenShape = () => ({
  name: 'Regen Coordination OS',
  pkgName: 'organizational-os-template',
  type: 'Hub',
  frameworkVersion: '3.0',
  remotes: { origin: 'https://github.com/regen-coordination/regen-coordination-os.git', upstream: CANONICAL_UPSTREAM },
});

/** refi-bcn-os: script entry present, target file absent. */
export const refiBcnShape = () => ({
  name: 'ReFi Barcelona (ReFi BCN)',
  pkgName: 'refi-bcn-os',
  type: 'LocalNode',
  frameworkVersion: '3.0',
  scripts: { 'sync:upstream': 'node scripts/sync-upstream.mjs' },
  remotes: { origin: 'https://github.com/refibcn/refi-bcn-os.git', upstream: CANONICAL_UPSTREAM },
});
