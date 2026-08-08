// ── context-bundle.mjs ───────────────────────────────────────────────────────
// Builds the grounding payload the Cloudflare OS workspace agent reads at
// conversation start: an org's identity, agent rules, memory index, recent
// decisions, and registry snapshots — everything an LLM needs to reason about
// an org's actual state without a human pasting it in first. Every field here
// is read by an LLM, not rendered to a UI, which is why truncation degrades
// gracefully (a readable prefix + a flag) instead of erroring, and why
// missing files degrade to `null` instead of throwing — a partial bundle is
// still useful context; a thrown error hands the agent nothing.
//
// Runs inside a Cloudflare Worker: no fs/path/child_process/ambient clock.
// `js-yaml` is the only permitted dependency.

import yaml from "js-yaml";
import { SubstrateError } from "../substrate/memory-substrate.mjs";

const DEFAULT_MAX_BYTES_PER_SECTION = 64_000;
const MAX_RECENT_DECISIONS = 5;
const DATED_HEADING = /^## \d{4}-\d{2}-\d{2}/;

// ── shared file read ─────────────────────────────────────────────────────
// One path for every optional file in the bundle. NOT_FOUND degrades to
// `null` — a missing file is the normal case, most org repos won't have
// every file this bundle wants. Anything else (UPSTREAM in particular) is a
// real backend failure — rate limit, network error, malformed upstream
// response — and is left to propagate rather than swallowed. Silently
// nulling a section on UPSTREAM would hand the agent a bundle that *looks*
// complete but is quietly missing content because GitHub hiccuped, with no
// signal that happened; NOT_FOUND is the only "this is fine, the file just
// isn't there" outcome.
async function readOptional(substrate, path) {
  try {
    return await substrate.readFile(path);
  } catch (err) {
    if (err instanceof SubstrateError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

// ── string sections (identity / agentRules / memoryIndex) ──────────────────
// Truncates to `maxBytes` and reports whether it did, via return value rather
// than a shared push target — see the `truncated[]` assembly note in
// `buildContextBundle` for why. `maxBytes` is a JS-string-length slice, not
// an actual byte count — the option is named "bytes" but the spec's own test
// pins char-length slicing (`maxBytesPerSection: 10` against a 100+-char
// string asserts `.length === 10`). Noted here rather than "fixed": a true
// byte-accurate slice would behave differently on multi-byte UTF-8 content,
// and the test pins this behavior deliberately.
//
// A further wrinkle left as-is for the same reason: slicing at a raw
// UTF-16 code-unit index can bisect a surrogate pair if a non-BMP character
// (emoji, some CJK) sits exactly at the cutoff, leaving a lone surrogate at
// the end of the returned string. Low-likelihood for prose files like these,
// and not worth guarding given the plan pins plain `.slice(0, n)`.
async function readTextSection(substrate, path, maxBytes) {
  const content = await readOptional(substrate, path);
  if (content === null) return { content: null, truncated: false };
  if (content.length > maxBytes) {
    return { content: content.slice(0, maxBytes), truncated: true };
  }
  return { content, truncated: false };
}

// ── recentDecisions ──────────────────────────────────────────────────────
// Splits DECISIONS.md into "## "-delimited sections — a section runs from a
// "## " heading to just before the next one, or EOF — and keeps only the
// ones whose heading is dated (`## YYYY-MM-DD...`). Real DECISIONS.md files
// across the org-os fleet open with non-dated boilerplate headings
// (`## Conventions` in bread-coop-os, `## How to Use This File` in
// refi-bcn-os) that must not reach the agent disguised as a recent
// organizational decision.
//
// org-os's DECISIONS.md convention is append-only, newest-first (verified
// against the framework's own root `DECISIONS.md`, and every fixture here
// follows suit): the most recent decision is the *first* "## " section in
// the file, not the last. So "the last 5" in the plan means the 5 most
// recent decisions — the first 5 dated sections encountered top-to-bottom —
// not a literal `.slice(-5)` on file order, which would instead grab the 5
// oldest. Returned in the same newest-first order they appear in the file.
//
// Known false-positive, not guarded against: a "## " line inside a fenced
// code block would be treated as a section boundary (and, if it happened to
// match the date pattern, as a dated section). No fixture or real
// DECISIONS.md exercises this, and fence-aware parsing isn't worth the
// complexity it would add here.
//
// Entries themselves are not subject to `maxBytesPerSection` truncation —
// only identity/agentRules/memoryIndex (whole-file reads that can be
// arbitrarily large) are. Slicing mid-entry would hand the agent a
// sentence-cut fragment of a specific historical decision — a worse failure
// mode than the size cap is solving for on the whole-file narrative blobs.
//
// The *list* is still capped at 5, though, and when a real cap happens
// (more than 5 dated sections exist) that's flagged in `truncated` under
// the name "recentDecisions" — same "this was cut down" signal the text
// sections give, and for the same reason: an agent asked "was there ever a
// decision about X" needs to know its answer set might be incomplete,
// rather than confidently answering "no" over a silently truncated list.
function splitDatedSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
    // Content before the first "## " heading (title, preamble) is discarded.
  }
  if (current) sections.push(current.join("\n"));

  return sections.filter((s) => DATED_HEADING.test(s));
}

async function readRecentDecisions(substrate) {
  const content = await readOptional(substrate, "DECISIONS.md");
  if (content === null) return { decisions: [], truncated: false };
  const dated = splitDatedSections(content);
  return {
    decisions: dated.slice(0, MAX_RECENT_DECISIONS),
    truncated: dated.length > MAX_RECENT_DECISIONS,
  };
}

// ── registries (projects / members) ─────────────────────────────────────
// `null` when the file is missing *or* unparseable — an LLM consumer can't
// do anything useful with a YAML parse error, so both failure modes
// collapse to the same "not available" signal rather than the caller having
// to distinguish them.
async function readRegistry(substrate, path) {
  const content = await readOptional(substrate, path);
  if (content === null) return null;
  try {
    return yaml.load(content) ?? null;
  } catch {
    return null;
  }
}

// ── buildContextBundle ───────────────────────────────────────────────────
// `truncated[]` is derived from each read's own ordered result rather than
// built by every reader pushing into one array they all share. The reads
// below run concurrently under `Promise.all`; a shared push target's
// insertion order would then depend on which promise happens to resolve
// first. That's stable under `MemorySubstrate` (synchronous under the hood)
// but timing-dependent under `GitHubSubstrate`'s real network latency, so
// the same bundle could report `["agentRules", "identity"]` on one call and
// the reverse on the next. Reading each flag off the positionally-ordered
// `Promise.all` result and re-assembling `truncated` in a fixed field order
// removes the shared mutable state instead of just papering over the race.

export async function buildContextBundle(substrate, { maxBytesPerSection = DEFAULT_MAX_BYTES_PER_SECTION } = {}) {
  const [identityR, agentRulesR, memoryIndexR, decisionsR, projects, members, provenance] = await Promise.all([
    readTextSection(substrate, "IDENTITY.md", maxBytesPerSection),
    readTextSection(substrate, "AGENTS.md", maxBytesPerSection),
    readTextSection(substrate, "MEMORY.md", maxBytesPerSection),
    readRecentDecisions(substrate),
    readRegistry(substrate, "data/projects.yaml"),
    readRegistry(substrate, "data/members.yaml"),
    substrate.head(),
  ]);

  const truncated = [];
  if (identityR.truncated) truncated.push("identity");
  if (agentRulesR.truncated) truncated.push("agentRules");
  if (memoryIndexR.truncated) truncated.push("memoryIndex");
  if (decisionsR.truncated) truncated.push("recentDecisions");

  return {
    identity: identityR.content,
    agentRules: agentRulesR.content,
    memoryIndex: memoryIndexR.content,
    recentDecisions: decisionsR.decisions,
    registries: { projects, members },
    provenance,
    truncated,
  };
}
