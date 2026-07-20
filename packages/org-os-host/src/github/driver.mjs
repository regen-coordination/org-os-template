import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// makeGithubDriver: behavior-preserving wrapper of org-os's current git/gh usage.
// Dependencies are injected so every method is unit-testable without git/gh/network:
//   exec(bin,args,{input}) -> { code, stdout, stderr }   (Task 5 chokepoint)
//   fetchFn(url,opts) -> Response-like                    (defaults to global fetch)
//   readLocal(path) -> string|null                        (defaults to fs read)
export function makeGithubDriver({ exec, fetchFn = globalThis.fetch, readLocal, cwd = '.' } = {}) {
  const readFile = readLocal || ((p) => (existsSync(p) ? readFileSync(p, 'utf8') : null));
  const git = (args, opts) => exec('git', args, opts);

  function repoSlug(entry) {
    if (typeof entry === 'string') return entry.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    return (entry?.repo) || (entry?.url ? entry.url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') : null);
  }

  return {
    resolveRemote(idOrUrl) {
      if (typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:')) {
        return { scheme: 'radicle', fetchUrl: null, canonical: false }; // not a github remote
      }
      const slug = repoSlug(idOrUrl);
      return { scheme: 'github', fetchUrl: slug ? `https://github.com/${slug}` : null, canonical: true };
    },

    whoami() {
      // org-os identities are github handles today; the driver does not shell out for this.
      return { id: null, handle: null };
    },

    async clone(entry, dest) {
      const slug = repoSlug(entry);
      if (!slug) return { ok: false, error: 'no repo slug' };
      const { code, stderr } = await git(['clone', `https://github.com/${slug}.git`, dest]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    // Local clone first (offline, authoritative), then raw.githubusercontent. Never throws.
    async fetchFile(entry, path, ref = 'HEAD') {
      const localBase = entry?.local_path ? join(cwd, entry.local_path, path) : null;
      if (localBase) {
        const local = readFile(localBase);
        if (local != null) return local;
      }
      const slug = repoSlug(entry);
      if (!slug) return null;
      const url = `https://raw.githubusercontent.com/${slug}/${ref}/${path}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetchFn(url, { signal: ctrl.signal });
          if (res && res.ok) return await res.text();
          return null;
        } finally { clearTimeout(timer); }
      } catch {
        return null; // unreachable/timeout → null, matches frontier's "stale beats broken"
      }
    },

    async listPeers(entry) {
      // github has no delegate/seed concept; peers come from config, not the host.
      return Array.isArray(entry?.peers) ? entry.peers : [];
    },

    async getCanonical(entry) {
      const opts = entry?.local_path ? { cwd: entry.local_path } : undefined;
      const { code, stdout } = await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], opts);
      let defaultBranch = 'main';
      if (code === 0 && stdout.trim()) defaultBranch = stdout.trim().split('/').pop();
      return { defaultBranch, threshold: 1, delegates: [] };
    },

    async getDrift(entry) {
      const opts = entry?.local_path ? { cwd: entry.local_path } : undefined;
      const br = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts);
      const canonicalRef = br.code === 0 ? br.stdout.trim() : 'main';
      const rl = await exec('git', ['rev-list', '--left-right', '--count', `HEAD...@{u}`], opts);
      let ahead = 0, behind = 0;
      if (rl.code === 0) {
        const [a, b] = rl.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
        ahead = a; behind = b;
      }
      return { behind, ahead, canonicalRef };
    },

    async push({ branch, remote = 'origin' } = {}) {
      const { code, stderr } = await git(['push', remote, branch]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    async openChange({ title, body = '', base = 'main' } = {}) {
      const { code, stdout, stderr } = await exec('gh', ['pr', 'create', '--title', title, '--body', body, '--base', base]);
      return { id: code === 0 ? stdout.trim() : null, ok: code === 0, error: code === 0 ? null : stderr };
    },

    async createIssue({ title, body = '' } = {}) {
      const { code, stdout, stderr } = await exec('gh', ['issue', 'create', '--title', title, '--body', body]);
      return { id: code === 0 ? stdout.trim() : null, ok: code === 0, error: code === 0 ? null : stderr };
    },

    async commentIssue({ id, body } = {}) {
      const { code, stderr } = await exec('gh', ['issue', 'comment', id, '--body', body]);
      return { ok: code === 0, error: code === 0 ? null : stderr };
    },

    async syncUpstream({ remote = 'upstream', branch = 'main' } = {}) {
      const fetch = await git(['fetch', remote]);
      if (fetch.code !== 0) return { ok: false, error: fetch.stderr };
      const pull = await git(['pull', '--rebase', remote, branch]);
      return { ok: pull.code === 0, error: pull.code === 0 ? null : pull.stderr };
    },

    webUrl(entry, path, ref = 'main') {
      const slug = repoSlug(entry);
      if (!slug) return null;
      return `https://github.com/${slug}/blob/${ref}/${path}`;
    },
  };
}
