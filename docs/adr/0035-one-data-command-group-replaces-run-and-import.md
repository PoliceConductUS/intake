# ADR 0035: One `data` Command Group Replaces `run` and `import`

## Status

Accepted

> Implements the generate/apply split proposed in ADR 0033 and the workspace-coupled
> chain of ADR 0034, but **supersedes the command surface** they and earlier ADRs
> describe. The pipeline is now a single `data` command group; the top-level `run`
> and `import artifacts` commands are gone. Supersedes the CLI vocabulary of
> **ADR 0003** (top-level `import artifacts`), **ADR 0014** (`import artifacts` as a
> user command), **ADR 0018** (`intake run` produces _and_ applies; "run becomes
> sugar for create then apply"), and **ADR 0033 §3/§10** (the `data-mutations` group
> name and its verbs).

## Context

ADR 0018 and ADR 0033 established the key split: producing a mutation and applying it
are separate steps. But the surrounding command surface accreted across ADRs and no
longer held together:

- **ADR 0003** put `import artifacts` at the top level and `run` as the produce
  command.
- **ADR 0018** framed `intake run` as producing _and_ applying a `DatabaseMutations`
  envelope, then said `run` "becomes sugar for `create` then `apply`."
- **ADR 0033** proposed a `data-mutations` group with `generate | up | down | status
| verify`, still surrounded by `run` (produce `Artifacts`) and `import` (diff +
  apply).

Three problems with that shape:

1. **`import artifacts` was never a user step.** Diffing a source's `Artifacts`
   against the database is what `generate` does internally to compute the next delta.
   Exposing it as a command invited applying a diff out of band — the exact
   out-of-order application the chain forbids.
2. **`data-mutations` under-described the group.** The same pipeline also acquires
   raw inputs and transforms them into `Artifacts`; those phases are not mutations.
3. **Two fused meanings of `run` lingered** — "produce `Artifacts`" and "produce and
   apply" — even though ADR 0018/0033 had already split produce from apply.

## Decision

The whole pipeline is **one `data` command group**, and its subcommands are the
pipeline's phases, in order.

**1. `intake data <phase>` is the entire surface.**

```
intake data acquire   <source-id>       # download/scrape a source's raw inputs
intake data transform <source-id>       # produce the source's Artifacts (ADR 0036)
intake data generate  <source-id>       # diff Artifacts vs DB head → append the next chain entry
intake data up        [--to <version>]  # apply pending chain entries, in order
intake data status                      # applied vs pending entries
intake data verify                      # recompute applied-entry checksums; fail on drift
intake data rebuild                     # transform → generate → up for every source, in dependency order
```

**2. `generate` and `up` keep the Liquibase split (ADR 0033 §3), renamed onto the
`data` group.** `generate` authors the next changeset — diff a source's transform
`Artifacts` against the database, which must be at the chain _head_, and append the
non-empty delta as the next entry, applying nothing; an empty diff appends nothing.
`up` applies pending entries whose predecessor is already in the ledger. This is
unchanged in substance from ADR 0033's `data-mutations generate` / `up`; only the
group name changed.

**3. `import artifacts` is not a command; it is what `generate` does internally.**
`data generate` runs the import as a **dry** diff (`Artifacts` → `DatabaseMutations`
delta) and appends that delta to the chain. The top-level `intake run` and `intake
import artifacts` commands are removed. The import remains as an internal library
(`runImportArtifactsCommand`), called only by `generate`; it has no CLI registration.

**4. `rebuild` replaces "re-run every source" with per-source chain authoring.** For
each source in dependency order (ADR 0021), `rebuild` runs transform → generate → up,
so a producer is applied before a consumer transforms against it. This is how the
genesis chain is authored and how a database is rebuilt against an externally-migrated
(typically blank) schema — the concrete form of ADR 0033 §1's "reconstruction is
replay."

**5. This CLI mutates data, not schema.** `data` owns the data-mutation chain only.
Schema migrations are applied out of band; their coupling to the chain stays the
min-version gate of ADR 0033 §7. `data up` never runs a schema migration.

**6. `down` is deferred.** ADR 0033 §9's downgrade is still the plan, but it is not
built; there is no `data down` yet. A correction today is a new forward entry.

**7. The chain lives in the workspace.** Per ADR 0034, entries live under
`$INTAKE_WORKSPACE/data/mutations`, coupled to the cache/ledger that mints their ids —
not committed. (ADR 0033's "chain directory is committed" consequence is superseded by
ADR 0034; this ADR only restates it for the command surface.)

## Consequences

- **Removed:** the `run` command (`src/cli/run/` no longer registers a command), the
  `import` command group (`src/cli/import/index.ts`), and `genesis.mjs`.
  `src/cli/import/artifacts/` stays as an internal library; its `registerCliCommand`
  is deleted (nothing discovered it once `import/index.ts` was gone).
- **Added:** `src/cli/data/` — the `data` group (`index.ts`) plus its phase glue
  (`source-pipeline.ts`, `chain.ts`); `acquire` registers into the group.
- **`transform` is the produce phase** (ADR 0036), replacing the produce meaning of
  `run`. The produce-and-apply meaning of `run` (ADR 0018) is retired entirely —
  produce is `transform`/`generate`, apply is `up`.
- **Docs updated:** the README CLI section now documents the `data …` surface.

## Alternatives Considered

- **Keep the `data-mutations` group name (ADR 0033 §10).** Rejected: the group also
  acquires and transforms, which are not mutations, and the name was a mouthful.
- **Keep `import artifacts` as a user command (ADR 0003/0014).** Rejected: it is the
  internal diff step of `generate`; exposing it invites applying a diff outside the
  chain's order.
- **Keep a single fused `run` (produce + apply, ADR 0018's "today").** Rejected: ADR
  0018/0033 already split produce from apply for replay; the fused command is the
  thing being retired, not preserved.
- **Two groups, `acquire`/`transform` separate from `data`.** Rejected: every phase
  operates on one source and feeds one chain; one group keeps the pipeline legible in
  `--help`.

## Revisit Trigger

`down` becomes necessary (ADR 0033 §9); schema migration needs to be folded back into
`data` rather than applied out of band; or a second, non-manual writer (CI) appends to
the chain and the single-writer assumption behind `generate`-against-head no longer
holds.
