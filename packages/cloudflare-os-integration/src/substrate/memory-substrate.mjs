// ── Substrate contract ───────────────────────────────────────────────────────
//
// A Substrate is the swappable storage driver behind every gatekeeper
// capability. Capabilities never touch GitHub (or any other backend)
// directly — they call these four methods (plus the optional `lastReadStale`
// property below). This keeps the page core and capabilities pure and lets
// storage be swapped (in-memory for tests, GitHub API for the pilot,
// workerd-local-git or Radicle later) without touching capability code.
//
// All four methods are async, even where an implementation (like this one)
// could answer synchronously — callers must not assume otherwise.
//
//   readFile(path) → Promise<string>
//     `path` is repo-relative with no leading slash, e.g. "data/projects.yaml"
//     or "IDENTITY.md". Returns the raw file contents as a string. Throws
//     `SubstrateError("NOT_FOUND")` if `path` does not name a file.
//
//   listDir(path) → Promise<Array<{ name: string, type: "file" | "dir" }>>
//     Returns the direct children of `path` (repo-relative, no leading or
//     trailing slash; "" means repo root), sorted by name. A subdirectory
//     contributes exactly one `{ name, type: "dir" }` entry regardless of how
//     many files it (transitively) contains — no recursion into it. A path
//     with no children returns `[]`. Unlike `readFile`, `listDir` never
//     throws `NOT_FOUND` — a missing or empty directory is indistinguishable
//     from an empty one and both yield `[]`.
//
//   head() → Promise<{ sha: string, date: string }>
//     Returns the current commit pointer for the substrate's ref: the commit
//     sha and its commit date (ISO date string). Used for envelope
//     provenance and staleness display.
//
//   proposeChange(change) → Promise<never>
//     Writes are out of scope until M3. Always throws an Error whose message
//     contains "M3" (read-only pilot).
//
//   Path precondition violations: callers are expected to pass `path` values
//   matching the shapes documented above (no leading/trailing slashes).
//   Violating that precondition is undefined-but-pinned behavior, not an
//   error: a malformed path (e.g. a leading or trailing slash) simply
//   matches no key, so `listDir` returns `[]` and `readFile` throws
//   `SubstrateError("NOT_FOUND")` — the same result as a genuinely absent
//   path, not a distinct failure mode.
//
//   lastReadStale (optional, mutable property, not a method)
//     A substrate *may* expose a mutable `lastReadStale: boolean` on itself.
//     Capabilities (Task 12's dispatcher) read it polymorphically after
//     calling into whatever substrate `substrateFor()` returns, to attach
//     `stale` to the provenance envelope (`substrate.lastReadStale === true`).
//     Absent or falsy means "not stale" — that default is a guarantee of the
//     contract, not an implementation accident, so every substrate is safe
//     to read this off of even if it never sets it. `MemorySubstrate` never
//     sets it: reads are served straight from the in-memory map, so they can
//     never be stale. `GitHubSubstrate` (Task 9) is the implementation that
//     actually sets it true, when a cache revalidation fails and it falls
//     back to serving cached content.
//
// SubstrateError codes used across the integration (name them consistently —
// Task 9's GitHubSubstrate and Task 12's capability dispatch both rely on
// this vocabulary):
//   NOT_FOUND  — the requested path does not exist.
//   UPSTREAM   — the backend itself failed (network error, non-404 HTTP
//                error, parse failure, etc). Not produced by MemorySubstrate,
//                which has no backend to fail against, but reserved here so
//                GitHubSubstrate doesn't invent a different vocabulary.

export class SubstrateError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "SubstrateError";
    this.code = code;
  }
}

// ── MemorySubstrate ──────────────────────────────────────────────────────────
// In-memory Substrate implementation backed by a flat `{ "relative/path":
// contents }` map — the same shape the test fixtures produce and
// `buildState` consumes. Used by tests and anywhere a real backend isn't
// needed.

export class MemorySubstrate {
  constructor(files, head) {
    this.files = files;
    this._head = head;
  }

  async readFile(path) {
    if (!Object.prototype.hasOwnProperty.call(this.files, path)) {
      throw new SubstrateError("NOT_FOUND", `not found: ${path}`);
    }
    return this.files[path];
  }

  async listDir(path) {
    const prefix = path === "" ? "" : `${path}/`;
    const entries = new Map(); // name -> "file" | "dir", insertion order irrelevant (sorted below)

    for (const key of Object.keys(this.files)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === "") continue;

      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        entries.set(rest, "file");
      } else {
        const dirName = rest.slice(0, slashIdx);
        // A dir entry always wins over a same-named file entry (can't
        // actually collide in a real filesystem, but dir takes precedence
        // defensively either way).
        if (entries.get(dirName) !== "dir") entries.set(dirName, "dir");
      }
    }

    return Array.from(entries, ([name, type]) => ({ name, type })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  async head() {
    return this._head;
  }

  async proposeChange() {
    // Deliberately a plain Error, not a SubstrateError, matching the plan's
    // spec for both this and Task 9's GitHubSubstrate — do not change this
    // without a plan update. Latent trap: Task 12's dispatch rule is "catch
    // SubstrateError → use its code; anything else → UPSTREAM," so once M3
    // wires writes into capability dispatch, this stub is indistinguishable
    // from a genuine backend failure. When that happens, this should likely
    // become `SubstrateError("NOT_IMPLEMENTED", ...)` so dispatch can tell
    // "unbuilt" apart from "broken."
    throw new Error("M3 — not implemented");
  }
}
