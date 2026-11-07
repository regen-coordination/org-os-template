// scripts/lib/test-failures.mjs
//
// The names of the tests that failed, read from a test runner's output, so
// selftest can say which test failed and not only where its output ended.
// It reads vitest's "FAIL  file > suite > test" headers and node --test's
// spec ("test at file:line" then "✖ name") and TAP ("not ok N - name")
// reports. On 2026-11-05 a CI selftest said only `213|     })` for the one
// failing admin test, which named neither the file nor the test.

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** `text` without terminal colour codes. */
export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

/**
 * The failing tests named in `output`, in order, each once. Empty when the
 * output names none: a crash before any test ran, or a runner this does not
 * know.
 */
export function failingTests(output) {
  const lines = stripAnsi(output).split(/\r?\n/);
  const names = [];
  const add = (name) => {
    const n = name.trim();
    if (n && !names.includes(n)) names.push(n);
  };

  // vitest: one header per failed test (or failed file) above its error.
  for (const line of lines) {
    const m = /^\s*FAIL\s{1,2}(\S.*)$/.exec(line);
    if (m) add(m[1]);
  }
  if (names.length) return names;

  // node --test, spec reporter: the "failing tests:" section lists each
  // failed test as "test at <file>:<line>:<col>" then "✖ <name> (<ms>)".
  const section = lines.findIndex((l) => /^\s*✖ failing tests:\s*$/.test(l));
  if (section > -1) {
    let at = null;
    for (const line of lines.slice(section + 1)) {
      const where = /^\s*test at (.+?):\d+:\d+\s*$/.exec(line);
      if (where) { at = where[1]; continue; }
      const m = /^\s*✖ (.+?)(?: \([\d.]+m?s\))?\s*$/.exec(line);
      if (m) { add(at ? `${at} > ${m[1]}` : m[1]); at = null; }
    }
    if (names.length) return names;
  }

  // node --test, TAP reporter: "not ok N - name". A suite reports its own
  // "not ok" right after its failed children, one level shallower: keep the
  // children and drop the suite.
  const tap = [];
  for (const line of lines) {
    const m = /^(\s*)not ok \d+ - (.+?)(?: # .*)?\s*$/.exec(line);
    if (m) tap.push({ depth: m[1].length, name: m[2] });
  }
  tap.forEach((t, i) => {
    if (i === 0 || tap[i - 1].depth <= t.depth) add(t.name);
  });
  return names;
}

/**
 * The one-line detail selftest prints for a failed check: the failing tests'
 * names when the output has them (the first `max`, then how many more), else
 * the output's last three lines, as before.
 */
export function failDetail(status, stdout, stderr, { max = 3 } = {}) {
  const output = `${stdout ?? ""}\n${stderr ?? ""}`;
  const names = failingTests(output);
  if (names.length) {
    const shown = names.slice(0, max).join("; ");
    const more = names.length > max ? ` (+${names.length - max} more)` : "";
    return `exit ${status}: failed: ${shown}${more}`;
  }
  const tail = stripAnsi(stderr || stdout || "")
    .trim()
    .split("\n")
    .slice(-3)
    .join(" | ");
  return `exit ${status}: ${tail}`;
}
