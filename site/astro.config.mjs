import { defineConfig } from "astro/config";
import { SITE_ORIGIN, BASE_PATH } from "./base.config.mjs";
import { PAGES } from "./src/data/docs-manifest.mjs";
import { REPO_ROOT, REPO_URL, SOURCE_REF, listRepoFiles } from "./src/lib/repo.mjs";
import remarkDocLinks from "./src/lib/remark-doc-links.mjs";
import remarkStripTitle from "./src/lib/remark-strip-title.mjs";
import rehypeTableScroll from "./src/lib/table-scroll.mjs";

export default defineConfig({
  // Deployed as a GitHub Pages *project* page, so the site lives under a
  // sub-path. `base` is what makes import.meta.env.BASE_URL (and therefore
  // src/lib/base.ts's withBase) resolve correctly. See base.config.mjs.
  site: SITE_ORIGIN,
  base: BASE_PATH,
  output: "static",
  build: { format: "directory" },
  markdown: {
    remarkPlugins: [
      remarkStripTitle,
      // Markdown is rendered outside the page pipeline, so withBase() is not
      // available to it; the plugin is given the base path directly.
      [remarkDocLinks, {
        pages: PAGES, repoRoot: REPO_ROOT, base: BASE_PATH,
        repoUrl: REPO_URL, ref: SOURCE_REF, listFiles: listRepoFiles,
      }],
    ],
    // A table wider than its column scrolls in a region that can be focused and is named.
    rehypePlugins: [rehypeTableScroll],
  },
  vite: { server: { fs: { allow: [".."] } } },  // dev server may import ../packages/*
});
