import { defineConfig } from "astro/config";
import { SITE_ORIGIN, BASE_PATH } from "./base.config.mjs";

export default defineConfig({
  // Deployed as a GitHub Pages *project* page, so the site lives under a
  // sub-path. `base` is what makes import.meta.env.BASE_URL (and therefore
  // src/lib/base.ts's withBase) resolve correctly. See base.config.mjs.
  site: SITE_ORIGIN,
  base: BASE_PATH,
  output: "static",
  build: { format: "directory" },
  vite: { server: { fs: { allow: [".."] } } },  // dev server may import ../packages/*
});
