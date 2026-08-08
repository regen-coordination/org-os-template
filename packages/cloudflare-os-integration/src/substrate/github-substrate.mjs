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
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.ref}`;
    const { status, body } = await this._cachedFetch(url, RAW_ACCEPT, (res) => res.text());
    if (status === "not_found") throw new SubstrateError("NOT_FOUND", `not found: ${path}`);
    if (status === "upstream") throw new SubstrateError("UPSTREAM", `upstream error reading ${path}`);
    return body;
  }

  async listDir(path) {
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.ref}`;
    const { status, body } = await this._cachedFetch(url, JSON_ACCEPT, (res) => res.text());
    // Per the Substrate contract, listDir never throws NOT_FOUND — a missing
    // directory and an empty one are both just "no children".
    if (status === "not_found") return [];
    if (status === "upstream") throw new SubstrateError("UPSTREAM", `upstream error listing ${path}`);
    const entries = JSON.parse(body);
    return entries.map(({ name, type }) => ({ name, type }));
  }

  async head() {
    const url = `${API_BASE}/repos/${this.owner}/${this.repo}/branches/${this.ref}`;
    const { status, body } = await this._cachedFetch(url, JSON_ACCEPT, (res) => res.text());
    if (status === "not_found") throw new SubstrateError("NOT_FOUND", `not found: branch ${this.ref}`);
    if (status === "upstream") throw new SubstrateError("UPSTREAM", `upstream error reading head`);
    const parsed = JSON.parse(body);
    return { sha: parsed.commit.sha, date: parsed.commit.commit.committer.date };
  }

  async proposeChange() {
    // Matches MemorySubstrate's stub — writes are out of scope until M3.
    throw new Error("M3 — not implemented");
  }

  // ── shared cache flow ────────────────────────────────────────────────────
  // Returns { status: "ok" | "not_found" | "upstream", body }. `readFile`,
  // `listDir`, and `head` differ only in URL, Accept header, and how they
  // parse `body` — that per-method work stays at the call sites.
  async _cachedFetch(url, accept, readBody) {
    const cached = this.cache.get(url);
    const now = this.now();

    if (cached && now - cached.fetchedAt < this.ttlMs) {
      this.lastReadStale = false;
      return { status: "ok", body: cached.body };
    }

    const headers = { Authorization: `Bearer ${this.token}`, Accept: accept };
    if (cached) headers["If-None-Match"] = cached.etag;

    const res = await this.fetchImpl(url, { headers });

    if (res.status === 304 && cached) {
      this.cache.set(url, { ...cached, fetchedAt: now });
      this.lastReadStale = false;
      return { status: "ok", body: cached.body };
    }

    if (res.ok) {
      const body = await readBody(res);
      this.cache.set(url, { etag: res.headers.get("etag"), body, fetchedAt: now });
      this.lastReadStale = false;
      return { status: "ok", body };
    }

    if (cached) {
      // Refresh failed (rate limit, transient upstream error, ...) but we
      // have last-known-good content — serve it and flag the staleness
      // rather than erroring.
      this.lastReadStale = true;
      return { status: "ok", body: cached.body };
    }

    return { status: res.status === 404 ? "not_found" : "upstream", body: undefined };
  }
}
