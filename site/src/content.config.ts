import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { PAGES } from "./data/docs-manifest.mjs";

// Loads exactly the files the manifest names, from the repository root (one
// level above this Astro project). Nothing is copied into site/.
// generateId keeps the path as written, so an entry's id equals its manifest
// `source` — the default would slugify and lower-case it.
const docs = defineCollection({
  loader: glob({
    base: "..",
    pattern: PAGES.map((p) => p.source),
    generateId: ({ entry }) => entry,
  }),
});

export const collections = { docs };
