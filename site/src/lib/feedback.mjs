// feedback.mjs — feedback is a prefilled GitHub issue. No backend, no script,
// nothing stored: the reader decides whether to send it.
const KINDS = {
  useful: { head: "Useful", prompt: "What worked? (optional)" },
  "not-useful": { head: "Not useful", prompt: "What were you looking for, and what was missing?" },
  problem: { head: "Problem", prompt: "What is wrong on this page? Quote the line if you can." },
};

/** @param {{ kind: string, title: string, source: string, verified: string | null, repoUrl: string }} input */
export function feedbackUrl({ kind, title, source, verified, repoUrl }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`feedbackUrl: unknown kind "${kind}"`);
  const params = new URLSearchParams({
    labels: "docs-feedback",
    title: `Docs — ${k.head}: ${title}`,
    body: [
      `Page: ${title}`,
      `Source: ${source}`,
      `Checked against: ${verified ?? "not yet verified"}`,
      "",
      k.prompt,
      "",
    ].join("\n"),
  });
  return `${repoUrl}/issues/new?${params}`;
}
