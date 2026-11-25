# Opening an instance

`npm run open` starts the launcher: one page on your own machine where you open, create or adopt an org-os
instance, and then land in that instance's admin.

    npm run open                    # http://localhost:4679/launch
    npm --prefix packages/admin run open -- --port 4700

The default port is 4679. The launcher builds the admin first, then serves `/launch`. Each instance you open gets its
own admin, on the next free port from 4680 up, and the launcher stops them when you stop it. The launcher is for your
own machine: a hosted Hub is one instance and refuses to start it.

## The four ways in

- **Open an instance.** Type the folder it is in, or paste a git address and the folder to clone it into. The doctor
  looks at it, its summary is saved, and its admin opens on "Map the rest".
- **Create a new one.** Answer the questions about your org. The launcher runs `clone:framework` into a new or empty
  folder, which gives the instance its genesis commit.
- **Adopt a repo.** For a repo you already have that is not an org-os instance. See "Adopt" below.
- **Join a network.** Paste a hub's address or the invite link it sent you, and choose **Look it up**. The launcher
  reads the hub's `federation.json` and says how it takes requests. Then open the instance that will ask, or create or
  adopt one to join. Its admin opens on the Federation page with the hub and the network filled in. Nothing is sent
  yet: you answer the hub's asks and send the request there, and the hub decides under its own rules. The launcher
  never sends an invite's token anywhere: it hands it to the Federation page in the address, and the admin keeps it
  outside git. See
  [Joining a network](FEDERATION.md#joining-a-network).

## What the launcher writes

This is the write path from the spec, §13 R7, exactly:

> **R7. The write path, exactly.** The launcher writes in five places only:
> - a folder that is new or empty (create, clone);
> - a new branch `org-os/adopt` of a clean repo that isn't org-os, adding files that don't exist there yet;
> - a scratch folder under the system temp directory, which it removes afterwards;
> - `~/.org-os/instances.json` (paths only);
> - the doctor's result for an opened instance, in that instance's admin state folder.
>
> §5.2's "empty or new folder only" holds for create and clone. Adopt is the one write into an existing repo, on
> those terms.

It never pushes. It never writes a repo's default branch. A folder you type as `~/x`, as a relative path, or as a
symlink is resolved to its real target first, and refused if that target is not empty. A git address that starts with
`-`, uses `ext::` or `fd::`, has spaces, or carries a token is refused before git runs. Only requests from the
launcher's own page are accepted (Origin and Host must match), and writes must be JSON.

## Adopt

Adopt is for a clean repo that is not org-os: no uncommitted or untracked files, no merge or rebase in progress, at
least one commit, and no `org-os/adopt` branch yet. Otherwise it refuses and writes nothing.

1. You answer the same questions as "Create a new one" (the folder is the repo).
2. The launcher scaffolds the framework into a scratch folder and works out which files your repo lacks.
3. It shows you three lists before anything is written: the files it would add, the files your repo already has,
   which are kept as they are, and the paths your `.gitignore` ignores, which are left out.
4. On "Add them on org-os/adopt", it creates the branch `org-os/adopt`, copies only the missing files (never
   overwriting one), and makes one commit there. Your repo's own git hooks run on that commit. Your default branch
   does not move. Merge the branch when you are ready.
5. The plan expires after 30 minutes and its scratch folder is removed.

## Map the rest

Opening lands on `/systems/map?first=1`, "Map the rest": list everything else the org runs.

- Paste one link per line and press Recognise. Repos, docs and other links become Systems you can edit.
- Entries from the old `repos.manifest.json` are offered as repo Systems.
- Tick a GitHub owner's repos to add them.
- "Stage" puts the additions in your change set (Changes), as proposals you review and apply. It writes nothing to
  `data/systems.yaml` by itself, and it clones nothing. You need to be a known member (your git email matches a
  member in `data/members.yaml`).

## Clone on a row

A repo System can carry a `mount` under `repos/`, the folder the canonical `.gitignore` ignores. Once the System is in
`data/systems.yaml`, its row on the Systems page shows the mount's branch, ahead/behind and uncommitted work, and
offers Clone for a mount that is not there yet. Clone is the `system.clone` operation, one row at a time.
