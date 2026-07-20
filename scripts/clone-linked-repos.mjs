#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveRemoteScheme } from '../packages/org-os-host/src/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'repos.manifest.json');
const gitmodulesPath = path.join(rootDir, '.gitmodules');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(manifestPath)) {
  console.error('Manifest not found: repos.manifest.json');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const baseDirectory = manifest.baseDirectory || 'repos';
const repositories = manifest.repositories || [];
const reposDir = path.join(rootDir, baseDirectory);
const submodulePaths = new Set();

if (fs.existsSync(gitmodulesPath)) {
  const gitmodules = fs.readFileSync(gitmodulesPath, 'utf-8');
  const pathMatches = gitmodules.matchAll(/^\s*path\s*=\s*(.+)\s*$/gm);
  for (const match of pathMatches) {
    submodulePaths.add(match[1].trim());
  }
}

fs.mkdirSync(reposDir, { recursive: true });

function run(command, cwd) {
  if (dryRun) {
    console.log(`[dry-run] (${cwd}) ${command}`);
    return;
  }
  execSync(command, { cwd, stdio: 'inherit' });
}

function isDirEmpty(dirPath) {
  const entries = fs.readdirSync(dirPath);
  return entries.length === 0;
}

const errors = [];

for (const repo of repositories) {
  const name = repo.name;
  const url = repo.url;
  const rid = repo.rid || (typeof url === 'string' && url.startsWith('rad:') ? url : null);
  // A rad: entry addresses via RID through the radicle driver's `rad` CLI; every
  // existing github entry (url is an https/git url, no rid) keeps the plain-git path.
  const isRadicle = resolveRemoteScheme(rid || url) === 'radicle';
  const branch = repo.branch || 'main';
  const targetPath = path.join(reposDir, name);
  const relativeTargetPath = path.relative(rootDir, targetPath);
  const gitDir = path.join(targetPath, '.git');

  if (!name || !(url || rid)) {
    console.warn('Skipping invalid manifest entry:', repo);
    continue;
  }

  if (submodulePaths.has(relativeTargetPath)) {
    console.log(`Skipping ${name}: managed as git submodule (${relativeTargetPath})`);
    continue;
  }

  try {
    if (fs.existsSync(gitDir)) {
      console.log(`Updating ${name}...`);
      if (isRadicle) {
        // Radicle repos are normal git repos once cloned; `rad sync` pulls in new
        // refs from seeds before we fast-forward the working branch.
        run('rad sync', targetPath);
        run(`git checkout ${branch}`, targetPath);
        run(`git pull rad ${branch}`, targetPath);
      } else {
        run('git fetch --all --prune', targetPath);
        run(`git checkout ${branch}`, targetPath);
        run(`git pull origin ${branch}`, targetPath);
      }
      continue;
    }

    // Remove empty dirs left from failed clones so we can retry
    if (fs.existsSync(targetPath) && !fs.existsSync(gitDir) && isDirEmpty(targetPath)) {
      console.log(`Removing empty directory ${name}/ for re-clone...`);
      fs.rmSync(targetPath, { recursive: true });
    }

    if (fs.existsSync(targetPath) && !fs.existsSync(gitDir)) {
      console.warn(`Skipping ${name}: target exists but is not a git repo (${targetPath})`);
      continue;
    }

    console.log(`Cloning ${name}...`);
    if (isRadicle) {
      run(`rad clone ${rid} "${targetPath}"`, rootDir);
    } else {
      run(`git clone --branch ${branch} "${url}" "${targetPath}"`, rootDir);
    }
  } catch (err) {
    const message = err.message.split('\n')[0];
    // run() uses execSync with stdio:'inherit', so a missing `rad` binary's stderr
    // goes to the terminal, NOT err.message — the shell's "command not found" surfaces
    // as exit code 127. Match that (plus the spawn-level ENOENT for completeness) so a
    // rid entry gets the actionable install hint instead of the generic hard-fail.
    if (isRadicle && (err.status === 127 || /ENOENT|command not found|rad: not found/i.test(err.message))) {
      console.warn(`Skipping ${name}: 'rad' CLI not available — install it: curl -sSf https://radicle.dev/install | sh`);
      continue;
    }
    if (repo.optional) {
      console.warn(`Skipping optional ${name}: ${message}`);
      continue;
    }
    console.error(`Failed to clone/update ${name}: ${err.message}`);
    errors.push(name);
  }
}

if (errors.length > 0) {
  console.error(`\nFailed repos: ${errors.join(', ')}`);
  process.exitCode = 1;
}

console.log(
  `\n${dryRun ? 'Dry run complete. ' : ''}Linked repositories are available in: ${reposDir}`,
);
