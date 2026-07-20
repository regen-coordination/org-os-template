import { parseRepoDoc, parseBlob } from './parse.mjs';

// radicle-httpd v6.1.0 client. Read-only by contract. Reads degrade to null,
// never throw (matches the HostDriver read-path invariant). `seed` is a base
// URL like https://seed.example (the org's own node, a garden node, or a public seed).
export function makeHttpd({ seed, fetchFn = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const base = `${String(seed).replace(/\/$/, '')}/api/v1`;

  async function getJson(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}${path}`, { signal: ctrl.signal });
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getRepo(rid) {
    const doc = await getJson(`/repos/${rid}`);
    return doc ? parseRepoDoc(doc) : null;
  }

  return {
    getRepo,
    async node() {
      return getJson('');
    },
    // Resolve the canonical head SHA, then fetch the blob by SHA (branch names 404).
    // ref is a commit SHA; when omitted we use the canonical head. (Radicle has no
    // working-tree ambiguity — httpd always serves a committed blob.)
    async fetchFile(rid, path, ref) {
      const repo = await getRepo(rid);
      if (!repo) return null;
      const sha = ref || repo.head;
      if (!sha) return null;
      const blob = await getJson(`/repos/${rid}/blob/${sha}/${path}`);
      return blob ? parseBlob(blob) : null;
    },
  };
}
