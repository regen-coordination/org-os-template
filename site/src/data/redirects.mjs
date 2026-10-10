// redirects.mjs — addresses the site used to serve, and where they go now.
// Each has a page under src/pages/ that renders <Redirect>; verify-build.mjs
// checks every one in the built output.
// `/about` goes to the Overview page, which says what org-os is and what an
// instance contains.
export const REDIRECTS = [
  { from: "/get-started", to: "/docs/setup" },
  { from: "/about", to: "/docs/overview" },
];
export const redirectFor = (from) => {
  const found = REDIRECTS.find((r) => r.from === from);
  if (!found) throw new Error(`redirects: no entry for ${from}`);
  return found.to;
};
