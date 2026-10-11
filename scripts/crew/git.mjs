// scripts/crew/git.mjs
//
// The only file that calls git. Nothing here touches the main checkout's working
// tree: it reads refs, and adds or removes linked worktrees elsewhere.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * What an ignored directory holds besides installed dependencies. git folds a
 * directory that holds only ignored files into one `!! dir/` line, which can
 * hide a `node_modules/` of any depth inside it; look inside, set every
 * `node_modules/` aside, and report the rest. A directory with none inside is
 * reported whole, as git did.
 */
function ignoredBeyondDependencies(root, rel) {
  let sawDependencies = false;
  const walk = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (!entry.isDirectory()) return [`!! ${path}`];
      if (entry.name === 'node_modules') {
        sawDependencies = true;
        return [];
      }
      return walk(path);
    });
  const found = walk(rel);
  return sawDependencies ? found : [`!! ${rel}/`];
}

export function createGit(mainDir) {
  return {
    /**
     * The repository's primary checkout: mainDir itself unless mainDir is a
     * linked worktree. A submodule keeps its git directory elsewhere and records
     * its checkout in core.worktree, so that is read before falling back to the
     * first entry of `git worktree list` (which would name the git directory).
     */
    primaryCheckout() {
      try {
        const common = git(mainDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
        let configured = '';
        try {
          configured = git(mainDir, ['config', '--file', join(common, 'config'), '--get', 'core.worktree']).trim();
        } catch {
          // core.worktree is not set: an ordinary repository
        }
        if (configured) return resolve(common, configured);
        const first = git(mainDir, ['worktree', 'list', '--porcelain']).split('\n')[0];
        return first.startsWith('worktree ') ? first.slice('worktree '.length) : mainDir;
      } catch {
        return mainDir;
      }
    },
    resolves(ref) {
      try {
        git(mainDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    },
    addDetached(path, ref) {
      git(mainDir, ['worktree', 'add', '--detach', path, ref]);
    },
    worktreeExists(path) {
      return existsSync(path);
    },
    /**
     * Everything in the worktree that removing it would lose: modified,
     * untracked and ignored files. Ignored files count (a `.env`, a draft in an
     * ignored folder) because git removes them without asking; installed
     * dependencies (a `node_modules/` directory, at any depth) do not. Build
     * output such as `dist/` is not dependencies and does count.
     */
    changes(path) {
      // NUL-separated, so a path with a space is not quoted. A staged rename or
      // copy is followed by its source path, which carries no status.
      const fields = git(path, ['status', '--porcelain', '-z', '--ignored']).split('\0');
      const lines = [];
      for (let i = 0; i < fields.length; i += 1) {
        const field = fields[i];
        if (field === '') continue;
        if (/^(.[RC]|[RC].) /.test(field)) i += 1;
        lines.push(field);
      }
      return lines.flatMap((line) => {
        const [, status, rel] = /^(..) (.*)$/.exec(line) ?? [];
        if (status !== '!!') return [line];
        if (!rel.endsWith('/')) return [line];
        if (/(^|\/)node_modules\/$/.test(rel)) return [];
        return ignoredBeyondDependencies(path, rel.slice(0, -1));
      });
    },
    /**
     * In a detached worktree: if HEAD is on no branch, create a branch there and
     * return its name; otherwise return null. `branch` is the name to use; when
     * it is taken (an earlier rescue of the same worktree) a numeric suffix is
     * added, so an earlier rescue branch is never moved.
     */
    rescueDetached(path, branch) {
      const head = git(path, ['rev-parse', 'HEAD']).trim();
      if (git(path, ['for-each-ref', '--contains', head, 'refs/heads']).trim() !== '') return null;
      const taken = (name) => {
        try {
          git(mainDir, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
          return true;
        } catch {
          return false;
        }
      };
      let name = branch;
      for (let n = 2; taken(name); n += 1) name = `${branch}-${n}`;
      git(mainDir, ['branch', name, head]);
      return name;
    },
    // No force flag: git itself refuses a worktree with changes.
    removeWorktree(path) {
      git(mainDir, ['worktree', 'remove', path]);
    },
  };
}
