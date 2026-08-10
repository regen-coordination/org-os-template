import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGates, STAGE_NAMES, CAPABILITIES_BY_STAGE } from "../scripts/lib/symbient-gates.mjs";

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

// --- totality ---------------------------------------------------------------

const HOSTILE = [
  ["null", null],
  ["undefined", undefined],
  ["empty string", ""],
  ["zero", 0],
  ["empty array", []],
  ["empty object", {}],
  ["number", 42],
  ["array document", "```yaml\n- wake\n- weave\n```\n"],
  ["scalar document", "```yaml\nhatchling\n```\n"],
  ["duplicate keys", "```yaml\nstage: 0\nstage: 2\n```\n"],
  ["unclosed brackets", "```yaml\ncapabilities: [wake, weave\n```\n"],
  ["boolean stage", "```yaml\nstage: true\n```\n"],
  ["quoted stage", '```yaml\nstage: "2"\n```\n'],
  ["negative stage", "```yaml\nstage: -1\n```\n"],
  ["max stage", "```yaml\nstage: 3\n```\n"],
  [
    "CRLF line endings",
    "# GATES\r\n\r\n```yaml\r\nstage: 1\r\ncapabilities: [wake, weave, becoming, surfacing]\r\n```\r\n\r\n## History\r\n",
  ],
];

test("totality: every input yields a well-formed result, never a throw", () => {
  for (const [label, input] of HOSTILE) {
    let g;
    assert.doesNotThrow(() => {
      g = parseGates(input);
    }, `threw on ${label}`);
    assert.equal(typeof g, "object", `${label}: not an object`);
    assert.notEqual(g, null, `${label}: null result`);
    assert.deepEqual(
      Object.keys(g).sort(),
      ["anomaly", "capabilities", "hatched", "next_threshold", "stage"],
      `${label}: wrong keys`,
    );
    assert.ok(Number.isInteger(g.stage), `${label}: stage not an integer`);
    assert.ok(g.stage >= 0 && g.stage <= 3, `${label}: stage out of range`);
    assert.ok(Array.isArray(g.capabilities), `${label}: capabilities not an array`);
    assert.ok(
      g.capabilities.every((c) => typeof c === "string"),
      `${label}: capabilities not all strings`,
    );
    assert.ok(g.anomaly === null || typeof g.anomaly === "string", `${label}: bad anomaly type`);
  }
});

// --- FIX-1: the top block is the region above the first `## ` heading --------

test("a yaml block under ## History cannot escalate the stage", () => {
  const g = parseGates("# GATES\n\n## History\n\n```yaml\nstage: 3\n```");
  assert.equal(g.stage, 0);
  assert.equal(g.anomaly, "no-top-block");
  assert.deepEqual(g.capabilities, ["wake", "weave", "becoming"]);
});

test("a realistic full GATES.md parses to its top block", () => {
  const full = `# GATES

<!-- Growth ledger. Written at hatch and at gate crossings only. -->

\`\`\`yaml
stage: 0
capabilities: [wake, weave, becoming]
hatched: 2026-08-10
next_threshold: ">=8 weave entries across >=3 weave files spanning >=2 weeks"
\`\`\`

## History

### 2026-08-10 — hatched (Stage 0 · hatchling)

Superseded block, quoted for the record:

\`\`\`yaml
stage: 3
capabilities: [wake, weave, becoming, surfacing, voice, commons, amendments]
\`\`\`
`;
  const g = parseGates(full);
  assert.equal(g.stage, 0);
  assert.deepEqual(g.capabilities, ["wake", "weave", "becoming"]);
  assert.equal(g.hatched, "2026-08-10");
  assert.match(g.next_threshold, /8 weave entries/);
  assert.equal(g.anomaly, null);
});

test("four backticks are not a yaml fence", () => {
  const g = parseGates("# GATES\n\n````yaml\nstage: 3\n````\n");
  assert.equal(g.stage, 0);
  assert.equal(g.anomaly, "no-top-block");
});

// --- FIX-2: anomaly signal ---------------------------------------------------

test("anomaly is null on the clean happy path", () => {
  assert.equal(parseGates(VALID).anomaly, null);
});

test("anomaly names the reason for each degradation", () => {
  assert.equal(parseGates(null).anomaly, "no-input");
  assert.equal(parseGates("").anomaly, "no-input");
  assert.equal(parseGates("# GATES\n\nno fence here\n").anomaly, "no-top-block");
  assert.equal(parseGates("```yaml\nstage: [unclosed\n```\n").anomaly, "unparseable");
  assert.equal(parseGates("```yaml\n- wake\n```\n").anomaly, "unparseable");
  assert.equal(parseGates("```yaml\nhatchling\n```\n").anomaly, "unparseable");
  assert.equal(parseGates("```yaml\nhatched: 2026-08-10\n```\n").anomaly, "bad-stage");
});

test("next_threshold is null (not undefined) on every fallback path", () => {
  for (const input of [null, "", "# GATES\n\nno fence\n", "```yaml\nstage: [unclosed\n```\n"]) {
    const g = parseGates(input);
    assert.equal(g.next_threshold, null);
    assert.notEqual(g.next_threshold, undefined);
    assert.ok("next_threshold" in g);
  }
});

// --- FIX-3: stage is authoritative ------------------------------------------

test("stage 3 is a valid boundary; stage -1 degrades with bad-stage", () => {
  const ok = parseGates("```yaml\nstage: 3\n```");
  assert.equal(ok.stage, 3);
  assert.deepEqual(ok.capabilities, CAPABILITIES_BY_STAGE[3]);
  assert.equal(ok.anomaly, null);

  const bad = parseGates("```yaml\nstage: -1\n```");
  assert.equal(bad.stage, 0);
  assert.equal(bad.anomaly, "bad-stage");
});

test("CAPABILITIES_BY_STAGE encodes the cumulative ladder", () => {
  assert.deepEqual(CAPABILITIES_BY_STAGE, [
    ["wake", "weave", "becoming"],
    ["wake", "weave", "becoming", "surfacing"],
    ["wake", "weave", "becoming", "surfacing", "voice", "commons"],
    ["wake", "weave", "becoming", "surfacing", "voice", "commons", "amendments"],
  ]);
  assert.ok(Object.isFrozen(CAPABILITIES_BY_STAGE));
  for (const row of CAPABILITIES_BY_STAGE) assert.ok(Object.isFrozen(row));
});

test("callers never receive the frozen ladder arrays", () => {
  const first = parseGates("```yaml\nstage: 2\n```");
  assert.deepEqual(first.capabilities, CAPABILITIES_BY_STAGE[2]);
  first.capabilities.push("amendments");
  first.capabilities[0] = "mutated";

  const second = parseGates("```yaml\nstage: 2\n```");
  assert.deepEqual(second.capabilities, ["wake", "weave", "becoming", "surfacing", "voice", "commons"]);
  assert.deepEqual(CAPABILITIES_BY_STAGE[2], [
    "wake",
    "weave",
    "becoming",
    "surfacing",
    "voice",
    "commons",
  ]);

  const echoed = parseGates("```yaml\nstage: 0\ncapabilities: [wake, weave, becoming]\n```");
  echoed.capabilities.push("voice");
  assert.deepEqual(parseGates("```yaml\nstage: 0\ncapabilities: [wake, weave, becoming]\n```").capabilities, [
    "wake",
    "weave",
    "becoming",
  ]);
});

test("missing or malformed capabilities fall back to the stage's own set", () => {
  assert.deepEqual(parseGates("```yaml\nstage: 1\n```").capabilities, [
    "wake",
    "weave",
    "becoming",
    "surfacing",
  ]);
  assert.deepEqual(parseGates("```yaml\nstage: 2\ncapabilities: wake\n```").capabilities, [
    "wake",
    "weave",
    "becoming",
    "surfacing",
    "voice",
    "commons",
  ]);
  assert.deepEqual(parseGates("```yaml\nstage: 3\ncapabilities: [wake, 7]\n```").capabilities, [
    "wake",
    "weave",
    "becoming",
    "surfacing",
    "voice",
    "commons",
    "amendments",
  ]);
});

test("capability echo that disagrees with the stage raises capability-mismatch", () => {
  const g = parseGates("```yaml\nstage: 2\ncapabilities: [wake, weave, becoming]\n```");
  assert.equal(g.stage, 2);
  assert.deepEqual(g.capabilities, ["wake", "weave", "becoming"]);
  assert.equal(g.anomaly, "capability-mismatch");

  // Order-insensitive: same members in a different order is not a mismatch.
  const ordered = parseGates("```yaml\nstage: 1\ncapabilities: [surfacing, becoming, weave, wake]\n```");
  assert.equal(ordered.anomaly, null);

  // bad-stage wins over capability-mismatch (first reason in precedence order).
  const both = parseGates('```yaml\nstage: "2"\ncapabilities: [wake, weave, becoming, voice]\n```');
  assert.equal(both.stage, 0);
  assert.equal(both.anomaly, "bad-stage");
});
