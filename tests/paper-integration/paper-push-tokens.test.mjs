// tests/paper-integration/paper-push-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/push-tokens.mjs",
);
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
});

// A fake Paper with a mutable token store so create/set/delete are observable.
function tokenStore(initial = []) {
  const store = new Map(initial.map((t) => [t.name, t]));
  const handlers = {
    get_tokens: () => text([...store.values()]),
    create_tokens: ({ tokens }) => {
      for (const t of tokens) store.set(t.name, t);
      return text(tokens.map((t) => ({ name: t.name, result: "created" })));
    },
    set_tokens: ({ tokens }) => {
      for (const t of tokens) {
        if (t.delete) store.delete(t.name);
        else store.set(t.name, { ...store.get(t.name), ...t });
      }
      return text(
        tokens.map((t) => ({
          name: t.name,
          result: t.delete ? "deleted" : "updated",
        })),
      );
    },
  };
  return { store, handlers };
}

const metered = (fake) => fake.calls.filter((c) => c.method === "tools/call");

test("push --dry-run: prints the plan, spends zero metered calls", async () => {
  const fake = await startFakePaper(tokenStore());
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE, "--dry-run"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /plan: 75 tokens · 4 skipped · 31 converted/);
    assert.match(r.stdout, /skipped: --refi-glow-blue — no Paper token type/);
    assert.match(r.stdout, /dry-run: nothing sent/);
    assert.equal(metered(fake).length, 0);
    assert.match(r.stderr, /metered calls: 0/);
  } finally {
    await fake.close();
  }
});

test("push: empty file → 1 get + 1 create batch with fileId; second run costs 1 call and changes nothing", async () => {
  const ts = tokenStore();
  const fake = await startFakePaper(ts);
  try {
    const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r1.status, 0, r1.stderr);
    const m1 = metered(fake);
    assert.deepEqual(
      m1.map((c) => c.params.name),
      ["get_tokens", "create_tokens"],
    );
    assert.equal(m1[1].params.arguments.fileId, "F1");
    assert.equal(m1[1].params.arguments.tokens.length, 75);
    assert.match(r1.stdout, /created: 75 · updated: 0 · pruned: 0/);
    assert.match(r1.stderr, /metered calls: 2/);
    assert.equal(ts.store.get("--refi-weight-bold").value, 700);
    assert.equal(ts.store.get("--refi-text-hero").value, "86px");

    fake.calls.length = 0;
    const r2 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r2.status, 0);
    assert.deepEqual(
      metered(fake).map((c) => c.params.name),
      ["get_tokens"],
    );
    assert.match(r2.stdout, /created: 0 · updated: 0 · pruned: 0/);
    assert.match(r2.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

test("push: changed value → set_tokens only for the changed names; extras reported not deleted", async () => {
  const ts = tokenStore([
    { type: "color", name: "--refi-color-blue", value: "#000000" },
    { type: "color", name: "--refi-legacy", value: "#123456" },
    { type: "color", name: "--color-primary", value: "#ffffff" },
  ]);
  const fake = await startFakePaper(ts);
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    const names = metered(fake).map((c) => c.params.name);
    assert.deepEqual(names, ["get_tokens", "create_tokens", "set_tokens"]);
    const set = metered(fake)[2].params.arguments.tokens;
    assert.deepEqual(set, [
      {
        name: "--refi-color-blue",
        value: "#4571E1",
        description: "brand.yaml color-blue",
      },
    ]);
    assert.match(r.stdout, /extra: 1 \(use --prune to delete\)/);
    assert.ok(ts.store.has("--refi-legacy"));
    assert.ok(ts.store.has("--color-primary"));
  } finally {
    await fake.close();
  }
});

test("push --prune: deletes only prefix-carrying extras", async () => {
  const ts = tokenStore([
    { type: "color", name: "--refi-legacy", value: "#123456" },
    { type: "color", name: "--color-primary", value: "#ffffff" },
  ]);
  const fake = await startFakePaper(ts);
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE, "--prune"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stderr);
    const set = metered(fake).find((c) => c.params.name === "set_tokens").params
      .arguments.tokens;
    assert.deepEqual(set, [{ name: "--refi-legacy", delete: true }]);
    assert.ok(!ts.store.has("--refi-legacy"));
    assert.ok(ts.store.has("--color-primary"));
    assert.match(r.stdout, /pruned: 1/);
  } finally {
    await fake.close();
  }
});

test("push: unreachable → exit 2; missing --tokens → exit 2 usage", async () => {
  const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /unreachable/);
  const r2 = await runScript(SCRIPT, [], { PAPER_FILE_ID: "F1" });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--tokens/);
});

test("push: --tokens path does not exist → exit 2, clean message, metered line, no stack trace", async () => {
  const r = await runScript(
    SCRIPT,
    [
      "--tokens",
      path.resolve(__dirname, "../fixtures/paper/does-not-exist.yaml"),
    ],
    { PAPER_FILE_ID: "F1" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^paper: /m);
  assert.match(r.stderr, /metered calls: 0/);
  assert.doesNotMatch(r.stderr, /at file:\/\//);
});

test("push: brand file with no tokens: map → exit 2, clean message, metered line, no stack trace", async () => {
  const r = await runScript(
    SCRIPT,
    ["--tokens", path.resolve(__dirname, "../fixtures/instance-config.yaml")],
    { PAPER_FILE_ID: "F1" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^paper: /m);
  assert.match(r.stderr, /metered calls: 0/);
  assert.doesNotMatch(r.stderr, /at file:\/\//);
});
