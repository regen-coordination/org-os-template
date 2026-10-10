// scripts/crew/git.mjs
//
// The only file that calls git. Nothing here touches the main checkout's working
// tree: it reads refs, and adds or removes linked worktrees elsewhere.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

export function createGit(mainDir) {
  return {
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
    changes(path) {
      return git(path, ['status', '--porcelain'])
        .split('\n')
        .filter((line) => line.trim() !== '');
    },
    // No force flag: git itself refuses a worktree with changes.
    removeWorktree(path) {
      git(mainDir, ['worktree', 'remove', path]);
    },
  };
}
