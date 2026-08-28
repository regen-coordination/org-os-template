import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// base resolves relative to the Astro project root (org-os/site). org-os/docs = ../docs.
const docs = defineCollection({
  loader: glob({ pattern: "*.md", base: "../docs" }),
});

export const collections = { docs };
