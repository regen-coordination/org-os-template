import { test } from "node:test";
import assert from "node:assert/strict";
import * as orgBuild from "../build-state.mjs";
import * as orgRender from "../render-page.mjs";
import * as orgParse from "../parse-helpers.mjs";
import * as shimBuild from "../../cloudflare-os-integration/src/page-core/build-state.mjs";
import * as shimRender from "../../cloudflare-os-integration/src/page-core/render-page.mjs";
import * as shimParse from "../../cloudflare-os-integration/src/page-core/parse-helpers.mjs";

test("old page-core paths re-export the same functions", () => {
  assert.equal(shimBuild.buildState, orgBuild.buildState);
  assert.equal(shimBuild.loadFederation, orgBuild.loadFederation);
  assert.equal(shimRender.renderPage, orgRender.renderPage);
  assert.deepEqual(shimRender.SUPPORTED_PAGES, orgRender.SUPPORTED_PAGES);
  assert.equal(shimParse.extractCheckboxes, orgParse.extractCheckboxes);
});
