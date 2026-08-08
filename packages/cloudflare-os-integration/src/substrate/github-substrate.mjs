// ── GitHubSubstrate ──────────────────────────────────────────────────────────
// Production Substrate implementation, backed by the GitHub REST Contents API.
// Satisfies the same four-method contract documented at the top of
// `memory-substrate.mjs` (readFile / listDir / head / proposeChange, plus the
// `lastReadStale` property) — read that header first, it's the authoritative
// spec. This file adds an ETag/TTL cache on top so repeated reads within a
// window don't hit the network, and a stale-while-revalidate fallback so a
// rate-limited or otherwise failing refresh serves the last-known-good
// content instead of erroring, flagging the response as stale via
// `lastReadStale`.
//
// Runs inside a Cloudflare Worker: no ambient clock or fetch — `now` and
// `fetchImpl` are always injected by the caller.

import { SubstrateError } from "./memory-substrate.mjs";

const API_BASE = "https://api.github.com";
const RAW_ACCEPT = "application/vnd.github.raw+json";
const JSON_ACCEPT = "application/vnd.github+json";
const ERROR_SNIPPET_MAX = 200;

// GitHub's Contents API path is `/`-separated but each segment must be
// percent-encoded individually — encoding the whole path would turn the "/"
// separators themselves into %2F and break routing.
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GitHubSubstrate {
  constructor({ owner, repo, ref, token, fetchImpl, cache, ttlMs = 60_000, now = () => Date.now() }) {
    this.owner = owner;
    this.repo = repo;
    this.ref = ref;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.cache = cache;
    this.ttlMs = ttlMs;
    this.now = now;
    this.lastReadStale = false;
  }

  async readFile(path) {
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.ref)}`;
    return this._cachedFetch(url, RAW_ACCEPT, path);
  }

  async listDir(path) {
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.ref)}`;
    let body;
    try {
      body = await this._cachedFetch(url, JSON_ACCEPT, path);
    } catch (err) {
      // Per the Substrate contract, listDir never throws NOT_FOUND — a
      // missing directory and an empty one are both just "no children".
      if (err instanceof SubstrateError && err.code === "NOT_FOUND") return [];
      throw err;
    }

    let entries;
    try {
      entries = JSON.parse(body);
    } catch (err) {
      throw new SubstrateError("UPSTREAM", `malformed directory listing for ${path}: ${err.message}`);
    }

    return entries
      // The Contents API can also return "symlink"/"submodule"; normalize
      // anything that isn't a dir to "file" so the documented "file" | "dir"
      // union always holds.
      .map(({ name, type }) => ({ name, type: type === "dir" ? "dir" : "file" }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async head() {
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(this.ref)}`;
    const body = await this._cachedFetch(url, JSON_ACCEPT, `branch ${this.ref}`);

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new SubstrateError("UPSTREAM", `malformed branch response for ${this.ref}: ${err.message}`);
    }
    return { sha: parsed.commit.sha, date: parsed.commit.commit.committer.date };
  }

  async proposeChange() {
    // Matches MemorySubstrate's stub — writes are out of scope until M3.
    throw new Error("M3 — not implemented");
  }

  // ── shared cache flow ────────────────────────────────────────────────────
  // Returns the response body string on success (fresh cache hit, 304, or
  // 2xx), or the last-known-good cached body when a refresh fails but a
  // cached entry exists (setting `lastReadStale`). Throws `SubstrateError`
  // (`NOT_FOUND` / `UPSTREAM`) when there's no cache to fall back on.
  // `label` is a human-readable request descriptor (the repo-relative path,
  // or "branch {ref}") used only for error messages.
  async _cachedFetch(url, accept, label) {
    const cached = this.cache.get(url);
    const now = this.now();

    if (cached && now - cached.fetchedAt < this.ttlMs) {
      this.lastReadStale = false;
      return cached.body;
    }

    const headers = { Authorization: `Bearer ${this.token}`, Accept: accept };
    if (cached) headers["If-None-Match"] = cached.etag;

    const res = await this.fetchImpl(url, { headers });

    if (res.status === 304 && cached) {
      this.cache.set(url, { ...cached, fetchedAt: now });
      this.lastReadStale = false;
      return cached.body;
    }

    if (res.ok) {
      const body = await res.text();
      this.cache.set(url, { etag: res.headers.get("etag"), body, fetchedAt: now });
      this.lastReadStale = false;
      return body;
    }

    if (cached) {
      // Refresh failed (rate limit, transient upstream error, ...) but we
      // have last-known-good content — serve it and flag the staleness
      // rather than erroring. The cached etag is deliberately left as-is so
      // the *next* revalidation still checks against the last confirmed-good
      // response, not the failed attempt.
      this.lastReadStale = true;
      return cached.body;
    }

    if (res.status === 404) {
      throw new SubstrateError("NOT_FOUND", `not found: ${label}`);
    }

    const snippet = await this._errorSnippet(res);
    throw new SubstrateError(
      "UPSTREAM",
      `upstream error ${res.status} for ${label}${snippet ? `: ${snippet}` : ""}`,
    );
  }

  // Best-effort truncated body text for a failed response, so a live rate
  // limit or server error is distinguishable in logs. Capped to keep a huge
  // error page from bloating the error message.
  async _errorSnippet(res) {
    try {
      const text = await res.text();
      return text ? text.slice(0, ERROR_SNIPPET_MAX) : "";
    } catch {
      return "";
    }
  }
}
