# USER.md — About Your Operator

_The person you're helping. Update as preferences surface through working together._

---

- **Who:** the framework's maintainer, named in `IDENTITY.md`
- **Role in org-os:** maintainer and architect

Personal details (timezone, languages, other roles, local folders, channels) are not kept in this public
repository. An instance's own `USER.md` is written fresh when the framework is cloned
(`templates/scaffold/USER.md`).

---

## Working Preferences

- **Response style:** concise — direct updates, no trailing summaries
- **Autonomy level:** act first on low-risk / reversible work; ask before destructive or shared-state changes
- **Language:** respond in language of prompt (default English)
- **Output format:** markdown with concrete file paths, commands, and file:line references

---

## Notes

- Default to naming the instance explicitly when giving updates.
- Strong preference for patterns over one-offs: if a solution could serve ≥2 instances, surface the promotion candidate.
- Values terse, evidence-based output. "Done" means verified (tests run, schemas validated), not claimed.
- Treats `data/*.yaml` as source of truth; any change there should trigger `npm run generate:schemas`.

---

_The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference._
