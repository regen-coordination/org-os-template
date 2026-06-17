import { defineConfig } from "astro/config";

export default defineConfig({
  // Domain is an open decision (spec §16) — placeholder until decided.
  site: "https://org-os.dev",
  output: "static",
  build: { format: "directory" },
});
