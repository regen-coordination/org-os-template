import { makeHttpd } from './httpd.mjs';
import { makeRadCli, defaultExec } from './rad-cli.mjs';
import { makeIdentity } from './identity.mjs';
import { parsePatchId, parseIssueId } from './cob.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// The radicle HostDriver. Reads via httpd (degrade to null/[]), writes via rad CLI
// (fail loudly through radCli). Accepts injected fetchFn/exec for testing; in
// production makeHttpd/makeRadCli supply real fetch/spawn.
export function makeRadicleDriver({ seed, fetchFn, exec, cwd = '.' } = {}) {
  const runExec = exec || defaultExec(); // real spawn when not injected (never a silent no-op)
  const httpd = makeHttpd({ seed, fetchFn });
  const radCli = makeRadCli({ exec: runExec, cwd });
  const identity = makeIdentity({ radCli, httpd });
  // Patches are git pushes to refs/patches (there is no `rad patch open`), so the
  // driver needs raw git access alongside the rad CLI. Share the ONE real executor —
  // an unset exec must not degrade git into a no-op that fakes a write success.
  const git = (args) => runExec('git', args, { cwd });

  return {
    resolveRemote(idOrUrl) {
      const isRad = typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:');
      return { scheme: isRad ? 'radicle' : 'github', fetchUrl: idOrUrl, canonical: isRad };
    },
    // whoami() returns the local node's real did:key (via `rad self`), not a placeholder.
    whoami: () => identity.whoami(),

    // ---- read path (httpd; degrade, never throw) ----
    async clone(rid, dest) {
      const out = await radCli.run(['clone', ridOf(rid), dest]).catch((e) => ({ __err: e }));
      if (out && out.__err) return { ok: false, error: String(out.__err.message) };
      return { ok: true, error: null };
    },
    fetchFile: (rid, path, ref) => httpd.fetchFile(ridOf(rid), path, ref),
    async listPeers(rid) {
      const { delegates } = await identity.delegatesOf(ridOf(rid));
      return delegates;
    },
    async getCanonical(rid) {
      const repo = await httpd.getRepo(ridOf(rid));
      if (!repo) return { defaultBranch: 'main', threshold: 1, delegates: [] };
      return { defaultBranch: repo.defaultBranch, threshold: repo.threshold, delegates: repo.delegates };
    },
    async getDrift(rid) {
      // Local git drift vs the canonical branch; radicle repos are normal git repos.
      const repo = await httpd.getRepo(ridOf(rid));
      const canonicalRef = repo?.defaultBranch || 'main';
      return { behind: 0, ahead: 0, canonicalRef }; // refined against a working copy in Plan 4's /sync wiring
    },

    // ---- write path (rad CLI; fail loudly) ----
    // Announce-only: `rad sync --announce` publishes local refs to seeds; it does NOT
    // push commits. Commit-push wiring (git push rad <branch>) is Plan 4's /sync work —
    // a caller must not assume this publishes new commits.
    async push({ branch } = {}) {
      await radCli.run(['sync', '--announce']);
      return { ok: true, error: null };
    },
    // A patch IS a git push to refs/patches (verified: rad 1.8.0 has no `rad patch open`).
    // The subject/body are carried as `-o patch.message=` push options; the new patch
    // id is printed on the push's stderr ("✓ Patch <oid> opened" / hint line).
    async openChange({ title, body = '', base = 'main' } = {}) {
      const opts = ['-o', `patch.message=${title}`, ...(body ? ['-o', `patch.message=${body}`] : [])];
      const res = await git(['push', 'rad', 'HEAD:refs/patches', ...opts]);
      if (res.code !== 0) {
        if (res.code === -1 || /ENOENT|command not found/i.test(res.stderr || '')) {
          throw new WriteUnavailableError('git is not available', { hint: 'install git' });
        }
        if (/node is not running|connection refused|not running/i.test(res.stderr || '')) {
          throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
        }
        return { id: null, ok: false, error: (res.stderr || '').trim() };
      }
      return { id: parsePatchId(`${res.stdout}\n${res.stderr}`), ok: true, error: null };
    },
    async createIssue({ title, body = '' } = {}) {
      const out = await radCli.run(['issue', 'open', '--title', title, '--description', body]);
      return { id: parseIssueId(out), ok: true, error: null };
    },
    async commentIssue({ id, body } = {}) {
      await radCli.run(['issue', 'comment', id, '--message', body]);
      return { ok: true, error: null };
    },
    async syncUpstream() {
      await radCli.run(['sync']);
      return { ok: true, error: null };
    },
    webUrl(rid, path, ref = '') {
      const r = ridOf(rid);
      return `https://app.radicle.xyz/nodes/seed.radicle.xyz/${r}/tree/${ref || 'HEAD'}/${path}`;
    },
  };
}

function ridOf(x) {
  if (typeof x === 'string') return x;
  return x?.rid || x?.repo || x?.id || '';
}
