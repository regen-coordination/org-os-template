# knowledge-commons org-os instance — branch experiment plan (I5)

**Status: prepared, awaiting operator execution.** The `knowledge-commons`
repo is not cloned beside this framework, and per Monty's condition its `main`
is never touched — so this plan is everything an operator (or their agent)
needs to execute `task-260827-luiz-orgos-branch` in one sitting, and nothing
has been run against that repo yet.

## The agreed shape

- A **lightweight** org-os instance (knowledge-management focus) living on a
  branch — suggested name `org-os-experiment` — of the group's
  `knowledge-commons` repo. `main` stays clean; merging anything is a later,
  separate value evaluation.
- This is the session's live proof *and* the first semi-external adoption
  datapoint (Active-2 pipeline).

## Execution (operator or agent, ~20 min)

Because the instance must live *inside* an existing repo on a branch — not in
the fresh sibling directory the engine produces — generate first, then graft:

```bash
# 1. Generate the instance normally (sibling dir, zero identity leaks)
cd org-os-template
npm run clone:framework -- --target ../kc-org-os --config kc-org-os.yaml

# 2. In knowledge-commons, cut the experiment branch off main
cd ../knowledge-commons
git switch -c org-os-experiment origin/main

# 3. Graft the instance in under a subdirectory (keeps the repo's own
#    root clean and the experiment self-contained + reversible)
mkdir org-os
rsync -a --exclude .git ../kc-org-os/ org-os/
git add org-os && git commit -m "experiment: lightweight org-os instance (branch-only, per 260827 sync)"
git push -u origin org-os-experiment
```

Suggested `kc-org-os.yaml` (adjust names with the group):

```yaml
org:
  name: "regen-knowledge-commons-os"
  tagline: "An org-shaped home for the knowledge commons"
  type: "Project"
  short_description: "Coordination substrate for the Regen Knowledge Commons working group."
  emoji: "📚"
  license: "MIT"
operator:
  name: "Luiz Fernando"
  email: "luizfernandolfsg@gmail.com"
network:
  name: "regen-coordination"
  upstream_url: "https://github.com/regen-coordination/org-os-template.git"
packages:
  operations: true
skills:
  - bootstrap-interviewer
  - org-os-init
  - knowledge-curator
  - meeting-processor
```

## Verification (same acceptance as any instance)

```bash
cd ../org-os-template
npm run doctor -- --dir ../knowledge-commons/org-os
# expect: no blockers except git-remote-absent-class findings
# (it lives inside knowledge-commons' repo — remotes are the host repo's)
```

Note: `doctor assess` on a nested instance will read the *host* repo's git
state for freshness/remote checks — findings about the host's remote are
expected and fine for the experiment.

## Session use + value evaluation

During the session: open `/initialize` inside `org-os/`, show the group their
own members/projects registries waiting to be filled, and run the
`bootstrap-interviewer` first pass live with the room. Afterward: the group
evaluates for ~2 weeks; a merge proposal to `main` happens only if they find
it valuable — that evaluation, not the merge, is the experiment's success
criterion.
