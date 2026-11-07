// tests/scripts/test-failures.test.mjs
//
// scripts/lib/test-failures.mjs: selftest names the failing tests. The
// outputs below are shaped like real vitest 3 and node --test runs, colour
// codes included (CI forces colour).
import { test } from "node:test";
import assert from "node:assert/strict";

import { failDetail, failingTests, stripAnsi } from "../../scripts/lib/test-failures.mjs";

const E = "\x1b";

// vitest 3, stderr: the failed test's header, its error and its code frame.
const VITEST_STDERR = [
  "",
  `${E}[31m⎯⎯⎯⎯⎯⎯⎯${E}[39m${E}[1m${E}[41m Failed Tests 1 ${E}[49m${E}[22m${E}[31m⎯⎯⎯⎯⎯⎯⎯${E}[39m`,
  "",
  `${E}[41m${E}[1m FAIL ${E}[22m${E}[49m app/src/library/EntryPreview.test.tsx${E}[2m > ${E}[22mEntryPreview${E}[2m > ${E}[22msays a failure once`,
  `${E}[31m${E}[1mAssertionError${E}[22m: expected [] to deeply equal [ 'The change could not be read.' ]${E}[39m`,
  "",
  `    ${E}[90m211| ${E}[39m      expect(voice.said).toEqual(['The change could not be read.'])`,
  `    ${E}[90m   | ${E}[39m                         ${E}[31m^${E}[39m`,
  `    ${E}[90m212| ${E}[39m      voice.stop()`,
  `    ${E}[90m213| ${E}[39m    })`,
  "",
  `${E}[31m${E}[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯${E}[22m${E}[39m`,
  "",
].join("\n");

// node --test, spec reporter: the summary's "failing tests:" section.
const SPEC_STDOUT = [
  "▶ group",
  `  ${E}[32m✔ fine ${E}[90m(0.3ms)${E}[39m${E}[39m`,
  `  ${E}[31m✖ the dates match ${E}[90m(1.1ms)${E}[39m${E}[39m`,
  `${E}[31m✖ group ${E}[90m(2.2ms)${E}[39m${E}[39m`,
  `${E}[34mℹ fail 1${E}[39m`,
  "",
  `${E}[31m✖ failing tests:${E}[39m`,
  "",
  "test at tests/scripts/dates.test.mjs:2:51",
  `${E}[31m✖ the dates match ${E}[90m(1.1ms)${E}[39m${E}[39m`,
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
  "  ",
  "  1 !== 2",
].join("\n");

// node --test, TAP reporter: a suite's "not ok" follows its failed child.
const TAP_STDOUT = [
  "TAP version 13",
  "# Subtest: group",
  "    # Subtest: fine",
  "    ok 1 - fine",
  "    # Subtest: the dates match",
  "    not ok 2 - the dates match",
  "      ---",
  "      failureType: 'testCodeFailure'",
  "      ...",
  "not ok 1 - group",
  "# Subtest: a top-level test that failed",
  "not ok 2 - a top-level test that failed",
  "# fail 2",
].join("\n");

test("stripAnsi drops colour codes and leaves the text", () => {
  assert.equal(stripAnsi(`${E}[31m✖ x${E}[39m`), "✖ x");
  assert.equal(stripAnsi(undefined), "");
});

test("vitest: the FAIL header names the file, its suites and the test", () => {
  assert.deepEqual(failingTests(VITEST_STDERR), [
    "app/src/library/EntryPreview.test.tsx > EntryPreview > says a failure once",
  ]);
});

test("node --test spec: each failing test with the file it is in", () => {
  assert.deepEqual(failingTests(SPEC_STDOUT), ["tests/scripts/dates.test.mjs > the dates match"]);
});

test("node --test TAP: the failed tests, not the suites that only hold them", () => {
  assert.deepEqual(failingTests(TAP_STDOUT), ["the dates match", "a top-level test that failed"]);
});

test("failDetail names the failing test where the old tail said only `213|     })`", () => {
  const detail = failDetail(1, "", VITEST_STDERR);
  assert.equal(
    detail,
    "exit 1: failed: app/src/library/EntryPreview.test.tsx > EntryPreview > says a failure once",
  );
});

test("failDetail reads stdout and stderr together: vitest's header can be in either", () => {
  assert.match(failDetail(1, VITEST_STDERR, "npm error code 1"), /failed: app\/src\/library\/EntryPreview/);
});

test("failDetail shows the first three names, then how many more", () => {
  const out = ["a", "b", "c", "d", "e"].map((n) => ` FAIL  x.test.ts > ${n}`).join("\n");
  assert.equal(failDetail(1, out, ""), "exit 1: failed: x.test.ts > a; x.test.ts > b; x.test.ts > c (+2 more)");
});

test("failDetail without test names keeps the last three lines, uncoloured", () => {
  assert.equal(
    failDetail(2, "", `one\ntwo\n${E}[31mthree${E}[39m\nfour\n`),
    "exit 2: two | three | four",
  );
});
