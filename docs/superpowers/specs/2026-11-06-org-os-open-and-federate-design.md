# org-os: the instance as the disk, opening an instance, and federating — design

- **Date:** 2026-11-06
- **Status:** accepted by the operator 2026-11-06 ("good, let's proceed"), with the recommended answers to
  §11.4 (this copy lives on org-os `feat/network`, cut from `feat/platform-full-l7` at `4cc9dc30`). §11.1–3 stay
  open; none of them blocks N0. Written without a question round, at the operator's request. Every choice not
  taken from the operator's own words is marked *my call* and gathered in §10.
- **Project:** org-os framework stewardship (lf-work-os).
- **Verified against:** org-os `feat/platform-full-l7` at `edd9b861`, the most complete platform tree. Nothing
  there is merged or pushed.
- **Revisions after reading the code for the N0 plan (2026-11-06):** see §12.
- **Vocabulary:** binding as in the 0.6 specs and `dao-os/CONTEXT.md`. These terms are used: instance, Hub (the
  product), hub node (the federation role), portal (the Hub's public side, `/portal`), System, proposal, rule,
  operator. "Surface" stays reserved for CLI/KMS/Admin/Conversational and is not used here.
- **Fits the convergence:** targets PR C or later. It touches nothing on PR A's paths (freeze Nov 11) or on
  sign-in/PR B's paths (Nov 22). §9 says what waits on what.

## 1. What this is for

The operator's three points, in their words:

1. org-os is a system for human and agent operation, built around **one repo per organization, the
   instance, which works as the disk for the whole org**. The org can have other repos, but those are
   mapped, and in practice they nest inside the instance. To start, you open an existing instance, create
   one, or transform a repo that isn't org-os yet. **Then you map the org's other repos and systems.**
2. **The federation needs to be easy to grow.** Someone who runs a local node opens their instance and
   federates it into the network. Sometimes federation is open, for example from a board, but it still goes
   through approval. **This matters now that the portals exist.**
3. Anything else that helps people adopt org-os and brings in other operators, in line with the 0.6
   convergence.

**Why now.** The 0.6 platform can now hold an organization: records, Systems, proposals decided by the
org's own rules, and a public portal. But only its maintainer can bring a new org in. Creating an instance
means running a command. Adopting an existing repo means using the CLI doctor or an agent recipe.
Federation means hand-editing YAML on both sides with nobody's approval. The network grows only as fast as
one person, and the portals now give outsiders a door with nothing behind it.

**What success looks like (my call):** an operator who isn't the maintainer opens or creates their
node's instance, maps their systems and asks to join a network, all in the platform. The hub's stewards
see that request, decide it under their own rules, and the node then shows on the hub's portal. That works
end to end, with no YAML edited by hand on either side.

## 2. Validation: what the code does today

| Aspect | Today (verified) | Gap |
|---|---|---|
| One instance per org, served by the platform | The server serves one repo (`--repo`, `packages/admin/server/index.ts:11`). Records, rules, proposals and the portal all come from that repo. | None in principle. **Holds.** |
| Other systems mapped | `data/systems.yaml` lists Systems with kinds `safe`, `gardens-*`, `snapshot-space`, `hats-tree`, `daouri-registration`, `docs`, `database`, `repo`, `kms-connector`, `link` (`packages/admin/schemas/systems.schema.json`). The `repo` driver reads another GitHub repo's published files, read-only (`server/systems/repo.ts`). | **Partial.** |
| Other repos nested in the instance | A second, separate mechanism: `repos.manifest.json` plus `repos/` (local clones). The platform doesn't treat these as Systems. | **Two lists for one thing.** |
| Open an existing instance | No picker. You start the server from inside the repo. | **Missing.** |
| Create a new instance | The "Open an instance" wizard (`lib/open-instance.mjs`) writes the config and *shows* `npm run clone:framework …`. It runs nothing, because the platform has no write path that can create a folder. | **Shown, not done.** |
| Transform a repo that isn't org-os | Only in the instance doctor's overlay path and `docs/ADOPT-WITH-AN-AGENT.md`. Both are CLI or agent only. | **Not in the platform.** |
| Federation | Peers are listed in `federation.yaml` and drawn by the fleet adapter on the Systems board, read-only (`server/resources/adapters/fleet.ts`). The federation-protocol plan is frozen ("deferred to v0.6+"). `docs/FEDERATION.md` says "a federation has exactly one hub". | **No request, no approval, no check that both sides agree.** |
| Federation goes through governance | `federation.yaml` is change class `identity` (`schemas/change-classes.json`), so editing it is already a proposal decided under the instance's rules. | **The machinery exists. It just has no input from outside the org.** |
| Portal as the door | `/portal` draws the org from `federation.yaml` identity. It has no network section and no way to ask to join. | **Missing.** |
| Discovery | `.well-known/` publishes `dao.json` (EIP-4824) and registries. Nothing machine-readable says what networks an instance belongs to or how to ask to join. | **Missing.** |

**In short:** "the instance is the disk" holds in the code. Opening it holds only for *create*, and even
that stops at a command shown on screen. Federation is still a hand-edited, one-sided list. The 0.6
governance engine is already the right place to decide a request to join.

## 3. Goals, non-goals, anti-goals

**Goals**
- G1. **One list of everything the org runs.** Every repo, account and on-chain system the org runs is a
  System in its instance. A repo can also be *mounted* as a local clone inside the instance.
- G2. **Four ways to open an instance, all in the platform:** open existing, create new, adopt a repo that
  isn't org-os, or join a network as a node. Each one ends with a "map the rest" step.
- G3. **Federation is a link both sides agree to,** asked for from the node and decided by the hub under
  the hub's own rules. It can be closed, by invite, open with approval, or open.
- G4. **The portal shows the network** (only nodes both sides have agreed to) and offers the join door
  that the hub's join policy allows.
- G5. **Adoption kit:** network starters, a public "check my repo", and an operator's first-hour path.

**Non-goals**
- Hosting a node for someone. L9's runbooks stay operator-run.
- Exchanging knowledge between peers (the frozen protocol). Federation here is membership and
  discovery. What flows over the link stays as it is.
- Moving GitHub organizations or repos around. Mounting never moves a repo.

**Anti-goals** (failure even if it works)
- Adopting a repo overwrites anything, or writes to its default branch.
- A node appears on a hub's portal, or a person appears anywhere, without their yes.
- One-sided lists are shown as membership.
- Joining a network requires the maintainer, a terminal or hand-edited YAML on the happy path.
- The platform signs anything or holds keys. On-chain steps are prepared, never signed (standing rule).

## 4. The instance is the disk

**4.1 One list.** `data/systems.yaml` becomes the single list of everything the org runs. `repo` Systems
gain two optional fields (*my call* on the names):
- `mount`: a path under the instance where a local clone lives, for example `repos/ReFi-BCN-Website`.
- `purpose` (renamed from `role`, see §12 R1): what the repo is to the org: `website`, `knowledge`, `app`,
  `contracts`, `data`, `fork`, `archive` or `other`.

`repos.manifest.json` stops being edited by hand. A step in `generate:schemas` writes it from the mounted
`repo` Systems, so the existing clone scripts keep working. An instance that has a manifest and no
systems.yaml entries gets a one-time import that stages them as additions (*my call*).

**4.2 What "nested" means in practice.** Crew, agents and the CLI work inside the instance and reach a
mounted repo through its path. A repo's commits stay in that repo. Mounted folders are gitignored by the
instance, the way `03 Libraries/*-os` already are in the vault. The Systems page shows each mounted repo's
branch, how far it is ahead of or behind its remote, and whether it has uncommitted work. These are
read-only facts.

**4.3 "Map the rest".** This is a step at the end of every way of opening, and also a page you can come
back to. You paste links, one per line: GitHub repos or whole organizations, Notion, Drive, a Safe address,
a Snapshot space, a website. Each link is recognised as a System kind and staged as an addition. A GitHub
organization is listed and you tick which repos to add. Nothing is cloned until you ask for it on a row.
Everything lands as staged changes, under the `systems` class and the org's rules.

## 5. Opening an instance

**5.1 The launcher.** Today the platform serves one repo. A small launcher, `npx org-os` / `npm run open`
(*my call*), starts the server for an instance chosen from a list of recent instances in
`~/.org-os/instances.json`. That list holds paths only and never any content. When no instance is chosen,
the launcher shows the four ways in. In hosted mode (L9) the launcher doesn't exist: a hosted Hub is
always one instance.

**5.2 The four ways in** (all local, under the launcher's own new write path, which can only create or
clone into an **empty or new** folder):

| Way in | What it does | Ends with |
|---|---|---|
| **Open existing** | Pick a local folder, or paste a git URL to clone into a new folder. Runs the doctor's read-only check. | The instance opens. Any doctor findings appear in "needs a look". |
| **Create new** | The existing wizard, now actually running `clone:framework` (same config, same refusal of a non-empty folder). | The new instance opens on its own trunk. |
| **Adopt a repo** | Pick an existing repo that isn't org-os. The doctor's overlay path assesses it, then shows the full file list it would add. It never overwrites a file. It commits on a new branch `org-os/adopt`, never the default branch. | The adopted repo opens on that branch. Merging it is the operator's own act. |
| **Join a network** | "Create new" or "adopt", pre-filled from a network: either an invite link or a hub's `.well-known/federation.json`. Applies the network's starter (§8) if there is one. | The instance opens, and a federation request is staged (§6). |

All four then go to "map the rest" (§4.3).

## 6. Federation as a two-sided, governed link

**6.1 States.** A link between two instances is in one of these states:
- **claimed**: one side lists the other.
- **requested**: a request has been sent and no decision has come back yet.
- **mutual**: both sides list each other.
- **left**: either side removed the link, and the other side still lists it.

Only mutual links count as membership anywhere: on the fleet card, the portal, `.well-known`. A claimed or
left link shows "needs a look". lf-work-os's present one-sided links would show as claimed, which is true
today.

**6.2 `federation.yaml` additions** (*my call*; read back-compatibly):
- `networks:` is a list of `{ name, hub, role }`. It replaces the single `network` / `hub` pair, which is
  still read as a one-item list. This drops FEDERATION.md's "exactly one hub" rule, because a local node
  can sit in more than one network, as ReFi BCN does with ReFi DAO and Regen Coordination.
- On a hub node, `join:` holds:
  - `policy`: `closed` | `invite` | `open-with-approval` | `open`.
  - `types`: which instance types may ask.
  - `asks`: what a request has to say, for example the operator's handle, a portal URL, a line about
    the node.
  - `where`: where requests go. A repo URL is enough for v1.
- Each `peers` entry gains `since` and `decision` (a reference to the hub's decision record). The state is
  never stored. It is computed from both sides' files.

**6.3 Discovery.** `generate:schemas` writes `.well-known/federation.json`: the instance's identity, its
networks, its mutual peers, and on a hub node its `join` block (*my call*: a separate file, so `dao.json`
stays pure EIP-4824). This file is what "Join a network" and the node's Federation page read when you
paste a hub's address.

**6.4 The request.** On the node's new **Federation page**, the operator pastes the hub's address or picks
a known network. Two things happen together:
1. The node stages adding the hub to its own `networks` and `peers`. This is its own `identity` change,
   decided under its own rules. In a solo instance that is a single decision.
2. The platform writes a **federation request**: the request record, plus the hub-side change it asks for,
   with commit trailers that name the node and the operator.

**Transport, v1 (git only, works today, needs no hosting).** The request goes to the hub as a branch or
pull request on the hub's repo. The platform opens it with `gh` when the operator has `gh`. Otherwise it
saves a file for the operator to send. On the hub's side, the platform's proposal list shows requests from
outside the org as their own group. An "Import a request" action covers a request that arrived as a file.

**Transport, v2 (after PR B sign-in and L9 hosting).** The hosted hub's portal has an **Ask to join** door.
The asker signs in, fills in the hub's `asks` fields, and the request arrives as an outside proposal.

**6.5 The decision.** Once the request is in, it is an ordinary 0.6 proposal under the `identity` class, so
the **hub's own rules decide it**. Nothing new is invented. The hub's `join.policy` only sets how a request
is received:

| Policy | What happens to a request |
|---|---|
| `closed` | It is refused when it arrives. |
| `invite` | It is accepted only with a matching invite (§6.6). |
| `open-with-approval` | It goes to the hub's normal decision path under its rules. This is the operator's "open, on a board, but approved" case. |
| `open` | It is applied under a standing decision recorded once. |

When the hub accepts, its own `peers` gets the node and the link becomes mutual. When the hub refuses, the
node's side shows "claimed, refused" with the reason, and nothing else changes. Leaving is also one change
on either side.

**6.6 Invites.** A hub steward makes an invite: a record holding the name, the expected type, an expiry and
the decision that approved it. The invite produces a link. Opening the link starts "Join a network"
pre-filled. A request that matches a live invite is accepted on arrival, because its decision was already
taken when the invite was made.

**6.7 Roles on-chain (optional, per hub).** A hub that gives node leads a hat (ReFi DAO's member plan:
"node leads … each with their own hat") can attach a *prepared* Hats transaction to the acceptance, using
L7's compose path. It is prepared, never signed, as everywhere else.

**6.8 Requests board.** On the hub's side, federation requests are records. They get a board in
`data/boards.yaml` with columns requested → under decision → mutual / refused (P4's boards, no new
machinery). This is the operator's "on a board" case.

## 7. Portals and the network

- **The hub's portal gains a Network section** that lists mutual nodes only. Each node shows its name,
  type, place and a link to its own portal. A node appears only if its own publication rules publish its
  identity. This follows the RKC portal's consent pattern (`lead_consent`).
- **The join door** on the portal follows `join.policy`:
  - `closed`: no door.
  - `invite`: "Ask a steward for an invite", with a contact.
  - `open-with-approval` and `open`: "Ask to join", which is the v2 form, or until then instructions for
    v1 plus the `.well-known` address.
- **A node's portal** shows "Part of <network>" for each mutual network.
- **Relation to the Brazil federated-portals spec (2026-10-21):** that spec is about *readers* (portals
  over records they don't own) across separate PDSes. This design is about *membership*. They meet in one
  place: a reader portal's list of nodes can be "the mutual nodes of network X" (*my call*: noted, not
  built here).

## 8. Bringing in operators: the adoption kit

These are ranked by how much they help adoption for what they cost (*my call*).

1. **Network starters (L10, generalised).** L10 already plans a "starter command" for DAO-OS. Make a
   starter a *network* overlay on the framework: templates, default rules, skills, the `networks` entry and
   the join request already filled in. Examples are "ReFi DAO local node", "Regen Coordination member" and
   "Brasil Regenerativo node". "Join a network" applies it. This is the biggest lever, because a node lead
   then starts from their network's way of working rather than a blank org.
2. **"Check my repo".** The doctor's read-only assessment of any repo, run from the launcher or by an
   agent. It lists what an org would gain and the exact files adopting would add. It's a low-commitment
   first contact, and it is the same code as "Adopt a repo".
3. **An operator's first hour.** One guide per way in, written for the person, not the framework. It
   replaces SETUP-PATHS's stub. ADOPT-WITH-AN-AGENT points its agent at the same four ways in, so people and
   agents follow one path.
4. **Federation health for hub stewards.** The fleet card's attention (drift, last sync, claimed or left
   links) becomes a list on the hub's side, so stewards can offer help before a node goes quiet.
5. **Operators as a circle.** Each hub keeps its node operators as members with a role, so the people who
   run nodes are visible to each other, for office hours, peer support or a shared channel. This is people
   data, so it follows the private-store rules.
6. **Languages.** pt-BR already exists in the wizard. Starters and guides ship per language, with terms
   taken from what each group already says (standing rule: never coined or translated).

## 9. Fit with the convergence, and order

Nothing here goes into PR A or PR B. A suggested order (*my call*), each step usable on its own:

| Step | Contents | Depends on |
|---|---|---|
| **N0: data** | `networks`, `join` and peer `since`/`decision` in `federation.yaml` and its schema. `.well-known/federation.json`. Link state computed. Fleet card shows mutual / claimed / not an instance / unknown (§12 R4). `repo` Systems `mount`/`purpose`. The manifest derived from systems. | None. It can sit on PR C. |
| **N1: opening** | The launcher and its write path (empty or new folder only). Open existing. Create new, actually run. Adopt on a branch. Map the rest. | N0 |
| **N2: federation v1** | Federation page, request record, git transport, outside-proposal group, Import a request, invites, requests board. | N0, P2 proposals |
| **N3: portal** | Network section, join door (v1 instructions), "Part of …". | N2, L9 portal build |
| **N4: hosted join** | The Ask to join form on hosted hubs, and prepared hats on acceptance. | PR B sign-in, L9 hosting, L7 |
| **N5: adoption kit** | Starters (with L10), Check my repo, first-hour guides, health list. | N1, N2 |

**Release test (my call):** two real links made through the flow alone:
- ReFi BCN asks ReFi DAO, and ReFi DAO's rules decide.
- refi-med-os is created from a ReFi DAO invite.

Plus one repo that isn't org-os, adopted on a branch with no file overwritten. This sits beside 0.6's
existing pilot gate rather than replacing it.

## 10. Calls I made (check while reading)

- The field names `mount`, `purpose`, `networks`, `join` and `join.policy`, and the four policy values.
- Dropping "exactly one hub" so a node can be in several networks.
- Link state is computed from both sides' files and never stored.
- `.well-known/federation.json` is separate from `dao.json`.
- v1 transport is a git branch or pull request, or a file. The portal form waits for sign-in and hosting.
- Adopting writes only to a new branch, never to the default branch, and never overwrites a file.
- The launcher keeps a local list of recent instances: paths only.
- The order N0–N5 and the release test.

## 11. Open for the operator

These only you can answer, and each one changes what gets built:

1. **First pilot pair.** Is ReFi BCN → ReFi DAO the right first real request, given the settlement and
   ReFi DAO's cut-over? The alternative is a Regen Coordination member or a Brazil node.
2. **Default join policy for the networks you steward.** For ReFi DAO, Regen Coordination and the RKC, is
   it `invite` or `open-with-approval`? Each network's council may need to decide this, not you.
3. **Node-lead hats on acceptance (§6.7).** In scope for N4, or left out? It touches the chain.
4. ~~Where this spec lives once it's accepted.~~ Answered: org-os `feat/network`.

## 12. Revisions after reading the code (2026-11-06, for the N0 plan)

These bind over the sections above where they differ.

- **R1. `role` is taken.** Systems already have `role` (`decides` | `acts`, where the System sits on the map). The
  repo field from §4.1 is called **`purpose`**, with the same values.
- **R2. `peers` holds two kinds of thing today.** ReFi BCN, ReFi DAO and refi-med-os list websites and
  knowledge-base repos in `peers` next to org-os instances. Their `repo` values come in four forms: a path
  relative to the instance, a path relative to the vault (`03 Libraries/…`), `owner/repo`, and a full URL,
  sometimes a `…/tree/main/<folder>` inside a monorepo. N0 reads all of them. It sorts each peer as **an
  instance**, **a repo** (it has no `federation.yaml`; it belongs in `data/systems.yaml`) or **unknown** (not
  readable from here), and it says so as a warning. It never fails a check and never moves an entry.
- **R3. `.well-known/federation.json` publishes claims, not mutual links.** The generator can see only its own
  side, so it publishes this instance's own peers. Readers compute mutual links by reading both sides, which
  matches "state is computed, never stored". A peer is published only when it has a public `url` (an `https`
  address) and isn't `visibility: private`. Its `notes`, `contact`, `relationship` and local paths are never
  published. Everything withheld is counted, never written. This matters because a peer like a private local sibling instance
  must stay unpublished.
- **R4. `requested` and `left` need the request record, so they arrive in N2.** N0 computes **mutual**,
  **claimed**, **not an instance** and **unknown**. It reads the other side from a local clone only. Fetching
  the other side's `.well-known/federation.json` over the network also arrives in N2.
- **R5. `federation.json` comes from the existing standards builder,** so it follows the builder's rules: it
  is written only when `identity.daoURI` is set, and it is leak-scanned and counted like every other file.
