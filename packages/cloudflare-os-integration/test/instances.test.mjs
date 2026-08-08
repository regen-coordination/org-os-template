import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInstances } from "../src/gatekeeper/instances.mjs";

test("accepts valid config, applies defaults", () => {
  const out = validateInstances([{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template" }]);
  assert.deepEqual(out, [{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template", ref: "main", trust: "read" }]);
});

test("rejects duplicates, bad ids, missing fields", () => {
  assert.throws(() => validateInstances([{ id: "a b", owner: "x", repo: "y" }]), /id/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y" }, { id: "a", owner: "x", repo: "z" }]), /duplicate/);
});

// ── explicit ref/trust are preserved, not overwritten by defaults ──────────
test("preserves explicit ref and trust instead of defaulting", () => {
  const out = validateInstances([
    { id: "refi-bcn-os", owner: "refibcn", repo: "refi-bcn-os", ref: "develop", trust: "write" },
  ]);
  assert.deepEqual(out, [
    { id: "refi-bcn-os", owner: "refibcn", repo: "refi-bcn-os", ref: "develop", trust: "write" },
  ]);
});

// ── top-level argument validation ───────────────────────────────────────────
test("throws when instances is not an array", () => {
  assert.throws(() => validateInstances(undefined), /array/);
  assert.throws(() => validateInstances(null), /array/);
  assert.throws(() => validateInstances({ id: "a", owner: "x", repo: "y" }), /array/);
  assert.throws(() => validateInstances("not-an-array"), /array/);
});

test("an empty array is valid and returns an empty array", () => {
  assert.deepEqual(validateInstances([]), []);
});

// ── id regex edge cases ─────────────────────────────────────────────────────
test("id regex: leading digit allowed, leading hyphen and uppercase rejected", () => {
  assert.doesNotThrow(() => validateInstances([{ id: "1-org", owner: "x", repo: "y" }]));
  assert.throws(() => validateInstances([{ id: "-org", owner: "x", repo: "y" }]), /id/);
  assert.throws(() => validateInstances([{ id: "Org", owner: "x", repo: "y" }]), /id/);
  assert.throws(() => validateInstances([{ id: "", owner: "x", repo: "y" }]), /id/);
});

// The plan's regex (/^[a-z0-9][a-z0-9-]*$/) allows a trailing hyphen — pinned
// here so a future tightening of the regex is a deliberate choice, not an
// accident.
test("id regex: trailing hyphen is allowed by the plan's regex", () => {
  assert.doesNotThrow(() => validateInstances([{ id: "org-", owner: "x", repo: "y" }]));
});

// ── owner/repo must be non-empty strings ────────────────────────────────────
test("rejects empty or non-string owner/repo", () => {
  assert.throws(() => validateInstances([{ id: "a", owner: "", repo: "y" }]), /owner/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: 5, repo: "y" }]), /owner/);
});

// ── owner/repo are interpolated raw into GitHub API URLs by GitHubSubstrate
// (owner/repo are NOT percent-encoded there, unlike path/ref) — so they must
// be constrained to a URL-safe character class here rather than just
// non-empty, or a stray "/", "?", or "#" silently reshapes the request.
test("rejects owner/repo containing URL-structural characters", () => {
  assert.throws(() => validateInstances([{ id: "a", owner: "x/y", repo: "z" }]), /owner/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x#y", repo: "z" }]), /owner/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x?y", repo: "z" }]), /owner/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x y", repo: "z" }]), /owner/);

  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y/z" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y#z" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y?z" }]), /repo/);
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y z" }]), /repo/);
});

// ── real-world GitHub names must still validate — periods are legal in repo
// names (e.g. GitHub Pages repos), and these are the actual Task 13 values.
test("accepts real-world GitHub owner/repo names, including periods", () => {
  assert.doesNotThrow(() =>
    validateInstances([{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template" }]),
  );
  assert.doesNotThrow(() => validateInstances([{ id: "refi-bcn-os", owner: "refibcn", repo: "refi-bcn-os" }]));
  assert.doesNotThrow(() => validateInstances([{ id: "pages", owner: "example", repo: "example.github.io" }]));
});

// ── trust must be a string when present, but no enum enforcement (M3 concern) ──
test("rejects non-string trust, accepts arbitrary string values", () => {
  assert.throws(() => validateInstances([{ id: "a", owner: "x", repo: "y", trust: 1 }]), /trust/);
  assert.doesNotThrow(() => validateInstances([{ id: "a", owner: "x", repo: "y", trust: "anything" }]));
});

// ── no mutation of caller input ─────────────────────────────────────────────
test("does not mutate the input array or its entries", () => {
  const input = [{ id: "org-os", owner: "organizational-os", repo: "organizational-os-template" }];
  const frozenEntry = Object.freeze(input[0]);
  const out = validateInstances(input);
  assert.equal(input.length, 1);
  assert.equal(input[0], frozenEntry);
  assert.deepEqual(input[0], { id: "org-os", owner: "organizational-os", repo: "organizational-os-template" });
  assert.notEqual(out[0], input[0]);
});
