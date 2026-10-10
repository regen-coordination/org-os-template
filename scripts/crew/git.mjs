// scripts/crew/git.mjs
//
// The only file that calls git. Nothing here touches the main checkout's working
// tree: it reads refs, and adds or removes linked worktrees elsewhere.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

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
     * dependencies do not.
     */
    changes(path) {
      return git(path, ['status', '--porcelain', '--ignored'])
        .split('\n')
        .filter((line) => line.trim() !== '' && !/^!! (.*\/)?node_modules\/$/.test(line));
    },
    /**
     * In a detached worktree: if HEAD is on no branch, create `branch` there and
     * return its name; otherwise return null.
     */
    rescueDetached(path, branch) {
      const head = git(path, ['rev-parse', 'HEAD']).trim();
      if (git(path, ['for-each-ref', '--contains', head, 'refs/heads']).trim() !== '') return null;
      git(mainDir, ['branch', branch, head]);
      return branch;
    },
    // No force flag: git itself refuses a worktree with changes.
    removeWorktree(path) {
      git(mainDir, ['worktree', 'remove', path]);
    },
  };
}
