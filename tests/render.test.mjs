import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../templates/render.mjs";

test("render interpolates simple variables", () => {
  const out = render("Hello {{ name }}!", { name: "World" });
  assert.equal(out, "Hello World!");
});

test("render handles nested object paths", () => {
  const out = render("{{ user.profile.name }}", { user: { profile: { name: "Ada" } } });
  assert.equal(out, "Ada");
});

test("render evaluates #if truthy/falsy", () => {
  const tmpl = "{{#if show}}YES{{/if}}{{#if hide}}NO{{/if}}";
  assert.equal(render(tmpl, { show: true, hide: false }), "YES");
  assert.equal(render(tmpl, { show: "ok", hide: "" }), "YES");
  assert.equal(render(tmpl, { show: ["a"], hide: [] }), "YES");
});

test("render iterates #each over arrays", () => {
  const tmpl = "{{#each items}}- {{ this }}\n{{/each}}";
  const out = render(tmpl, { items: ["alpha", "beta", "gamma"] });
  assert.equal(out, "- alpha\n- beta\n- gamma\n");
});

test("render iterates #each over array of objects exposing fields", () => {
  const tmpl = "{{#each items}}- {{ name }} ({{ kind }})\n{{/each}}";
  const out = render(tmpl, {
    items: [
      { name: "alpha", kind: "first" },
      { name: "beta", kind: "second" },
    ],
  });
  assert.equal(out, "- alpha (first)\n- beta (second)\n");
});

test("render includes partials from partials map", () => {
  const tmpl = "{{> hello }}";
  const out = render(tmpl, { name: "World" }, {
    partials: { hello: "Hi {{ name }}!" },
  });
  assert.equal(out, "Hi World!");
});

test("render leaves unknown partials as-is", () => {
  const tmpl = "{{> nonexistent }}";
  const out = render(tmpl, {});
  assert.equal(out, "{{> nonexistent }}");
});

test("render handles missing variables as empty", () => {
  const out = render("Hello {{ missing }}!", {});
  assert.equal(out, "Hello !");
});

test("render handles nested blocks", () => {
  const tmpl = "{{#each users}}{{#if active}}{{ name }} {{/if}}{{/each}}";
  const out = render(tmpl, {
    users: [
      { name: "alice", active: true },
      { name: "bob", active: false },
      { name: "carol", active: true },
    ],
  });
  assert.equal(out, "alice carol ");
});
