# ADR 0036: Rename the Produce Phase from `run` to `transform`

## Status

Accepted

> Completes the command-surface change of ADR 0035 by renaming the produce phase
> end to end. Supersedes the "run phase" / "produce phase" terminology used
> descriptively in **ADR 0021**, **ADR 0022** (the acquire/run split is now the
> acquire/transform split), **ADR 0023**, **ADR 0030**, and **ADR 0032**, and
> establishes the `transform.ts` source-module convention. No prior ADR named the
> per-source module file, so this ADR sets that name rather than replacing one.

## Context

ADR 0035 made the produce phase's CLI verb `data transform`. But the phase kept its
old name, `run`, everywhere else: the code (`src/cli/run/`), the per-source module
(`sources/<id>/run.ts` exporting `run`), the types (`SourceRun`, `RunDeps`,
`RunDataContext`), and the phase terminology in the ADRs. So the command said
_transform_ while the code and files said _run_ — a reader could not grep one name to
find the phase. "run" is also a generic word (`runIntake`, `dryRun`, "the tests run"),
which made the mismatch worse: a search for the phase hit dozens of unrelated uses.

A source folder's phase modules had grown up as `run.ts` (produce) and `acquire.ts`
(download/scrape) by code convention — `acquire.ts` already matched its verb, but
`run.ts` did not match `transform`.

## Decision

**The produce phase is named `transform` everywhere, and a source's phase modules are
named for the CLI verb that runs them.**

**1. One name, end to end.** The phase is `transform`: the CLI verb (`data transform`,
ADR 0035), the code (`src/cli/transform/`), the phase-types module
(`source-transform.ts`), and the types — `SourceTransform`, `TransformDeps`,
`TransformDataContext` (and its factory `createTransformDataContext`),
`TransformSourceDeps` / `buildTransformSourceDeps`.

**2. A source is a folder with `transform.ts`.** Every source under `sources/` has a
required `transform.ts` and an optional `acquire.ts`. Phase modules are named for the
verb that runs them (`transform.ts` ↔ `data transform`, `acquire.ts` ↔ `data
acquire`). `transform.ts` exports `transform` (the produce function), `produces` (its
declared kinds, ADR 0021), and an optional `standalone` flag; `acquire.ts` exports
`acquire`. `transform.ts` is what makes a folder a source.

**3. Detection follows the file name.** The source glob (which folders are sources)
and `describeSources` (the `sources` catalog) both key on `transform.ts` and report
the `transform` phase. Fail-loud messages name `transform.ts` ("no transform module
at …", "must export a transform function").

**4. ADR terminology follows.** Where earlier ADRs say "the run phase" or "run
(produce)", read "the transform phase"; the **acquire/run split** of ADR 0022 is the
**acquire/transform split**. The meaning is unchanged: non-determinism and network live
in `acquire`; `transform` is deterministic.

## Consequences

- **Pure rename, no behavior change.** Directories `src/cli/run/` → `src/cli/transform/`
  and `test/cli/run/` → `test/cli/transform/`; `source-run.ts` → `source-transform.ts`;
  every `sources/<id>/run.ts` → `transform.ts` and its test/fixture counterparts; the
  loader reads `module.transform`. The full suite stays green.
- **`acquire.ts` is unchanged** — it already matched its verb; only the produce module
  moved.
- **Grep-ability.** The phase is now findable by one specific word; the generic uses of
  "run" (`runIntake`, `dryRun`) no longer collide with it.

## Alternatives Considered

- **Keep `run.ts` as "the source's run function" while the verb is `transform`.**
  Rejected: that is exactly the command/file mismatch this ADR removes.
- **Name the module `produce.ts`.** Rejected: the CLI verb is `transform`, and the
  rule is that phase modules are named for their verb.
- **Rename only the CLI-facing code, leaving source files as `run.ts`.** Rejected:
  the source files _are_ the most user-facing surface a source author touches; leaving
  them mismatched defeats the alignment.

## Revisit Trigger

A new pipeline phase/verb is added (its source module should be named for it, per
Decision 2); or the produce phase is renamed again at the CLI, in which case the
modules and types move with it.
