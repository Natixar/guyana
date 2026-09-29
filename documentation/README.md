# documentation/ — how this system is built

This directory was created on 8 September 2026 (issue #96). Until then, the project
documented its architecture nowhere but in issues, pull requests and code comments —
three places where one finds *why a decision was taken*, never *how the whole thing
holds together*.

## What this directory is, and what it is not

**It is not the source of truth.** The code is. `deploy/steps/60-app.sh` decides
routing; this documentation explains it. When the two diverge, the documentation is
the one that is wrong, and that is a defect to be fixed like any other.

**Nor is it `deploy/README.md`.** That one states the deployment *invariants* —
assertions that `deploy/verify/*.bats` can make fail. Here we explain mechanisms,
compare options, and keep a record of what was measured. A document here breaks no
test; that is precisely why it must carry a date and say what was observed on that
day.

**It is not `analyses/`.** That directory is ignored by git: it holds working
documents, correspondence, and data that cannot leave the control post.
`documentation/` is version-controlled, **and the repository is public**: nothing
covered by clause 9 of the collaboration agreement goes in, no identifier, no secret,
no outside person's name.

## Conventions

```
NN_subject.md
```

Numbering is stable, increasing, never reassigned. A cross-reference is made through
a relative link, never by spelling out "note 2".

**Version-controlled documents are written in English, file names included.**
Decision of the maintainer, 29 September 2026. Every note in this directory now
follows it; what remains elsewhere in the repository is tracked by #142, and the
French comments inside code and configuration files by #105. A rename breaks every
link already shared outside the repository, so it happens before a note is merged
whenever that is still possible.

## The notes

| | |
|---|---|
| [01 — Hosting and routing of the static site](01_hosting-and-routing.md) | The full chain: Hugo → image → container → Traefik → domain. Who serves what, and what is not ours. |
| [02 — static-web-server](02_static-web-server.md) | The server chosen: what it can do, what we use of it, how its container is built and deployed. |
