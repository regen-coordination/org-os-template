import { parseRadSelf } from './parse.mjs';

// did:key identity + the delegate/threshold governance model. Reads come from httpd
// (the repo's identity doc); the local operator's own did comes from `rad self`.
export function makeIdentity({ radCli, httpd } = {}) {
  return {
    async whoami() {
      if (!radCli) return { id: null, did: null };
      const out = await radCli.run(['self']);
      const { did } = parseRadSelf(out);
      return { id: did, did };
    },
    async delegatesOf(rid) {
      const repo = await httpd.getRepo(rid);
      if (!repo) return { delegates: [], threshold: 1 };
      return { delegates: repo.delegates, threshold: repo.threshold };
    },
    // write ops (add a delegate / set threshold) go through rad id — fail loudly via radCli.
    async addDelegate(rid, did) {
      return radCli.run(['id', 'update', '--repo', rid, '--delegate', did]);
    },
    async setThreshold(rid, n) {
      return radCli.run(['id', 'update', '--repo', rid, '--threshold', String(n)]);
    },
  };
}
