import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGates, STAGE_NAMES } from "../scripts/lib/symbient-gates.mjs";

const VALID = `# GATES

\`\`\`yaml
stage: 2
capabilities: [wake, weave, becoming, surfacing, voice, commons]
hatched: 2026-08-10
next_threshold: "a commons exchange that changed an operator decision"
\`\`\`

## History

### 2026-08-10 — hatched (Stage 0)
`;

test("parses a valid top block", () => {
  const g = parseGates(VALID);
  assert.equal(g.stage, 2);
  assert.deepEqual(g.capabilities, ["wake", "weave", "becoming", "surfacing", "voice", "commons"]);
  assert.equal(g.hatched, "2026-08-10");
  assert.match(g.next_threshold, /commons exchange/);
});

test("STAGE_NAMES maps the ladder", () => {
  assert.deepEqual(STAGE_NAMES, ["hatchling", "surfacer", "voiced", "self-amending"]);
});

test("missing yaml fence → Stage 0 defaults", () => {
  const g = parseGates("# GATES\n\nno fence here\n");
  assert.equal(g.stage, 0);
  assert.deepEqual(g.capabilities, ["wake", "weave", "becoming"]);
  assert.equal(g.hatched, null);
});

test("malformed yaml → Stage 0 defaults", () => {
  const g = parseGates("```yaml\nstage: [unclosed\n```\n");
  assert.equal(g.stage, 0);
});

test("out-of-range or non-numeric stage → 0", () => {
  assert.equal(parseGates("```yaml\nstage: 7\n```").stage, 0);
  assert.equal(parseGates("```yaml\nstage: voiced\n```").stage, 0);
});

test("empty / non-string input → Stage 0 defaults", () => {
  assert.equal(parseGates("").stage, 0);
  assert.equal(parseGates(undefined).stage, 0);
});
