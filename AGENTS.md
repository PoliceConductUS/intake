# AGENTS.md

## Purpose

This file defines project-specific guidance for agents working in this repository.

`intake` contains Supabase schema, migrations, and seed data for the Institute
for Police Conduct, Inc. The development style is outcome-driven, direct,
evidence-based, and hostile to speculative complexity.

Use this file for local repository doctrine. It must be self-contained because
an agent working in this repo may not be able to read sibling repositories.
When available, the shared Institute for Police Conduct engineering standards
provide the longer human-facing rationale:

- `../engineering-standards/docs/engineering-principles.md`
- `../engineering-standards/docs/ai-assisted-development.md`
- `../engineering-standards/docs/contribution-and-review.md`
- `../engineering-standards/docs/project-setup-standard.md`

Use Superpowers for execution discipline, including brainstorming, planning,
TDD, debugging, review, verification, branch finishing, and worktree setup.

## Prime Directive

Build the smallest correct thing that produces the intended outcome.

Use outcomes-driven development with an outside-in approach: start from the user
or system outcome, define the observable behavior, then work inward to the
smallest implementation that satisfies it.

Do not optimize for imagined future needs. Do not preserve old behavior unless it
is explicitly required. Do not add fallback behavior unless it is explicitly
required and tested. Do not invent requirements or hide uncertainty.

When requirements are ambiguous, prefer the smallest safe interpretation, state
the assumption plainly, and keep the change reversible. Ask the user only when a
wrong assumption would cause meaningful harm.

When the user directly requests a fix or implementation, that request is
approval to make the necessary scoped edits. Do not stop for a second approval
round unless the change introduces an architectural compromise, weakens an
invariant, changes data semantics, touches unrelated behavior, or has materially
risky/ambiguous scope. For optional work, broad cleanup, or changes the user has
not directly requested, summarize the exact files and changes and wait for
explicit approval before editing.

## Workflow References

- Superpowers governs how agents execute work in this repo.
- OpenSpec governs intended behavior and change artifacts.
- Trunk-based development governs integration: keep branches short-lived, scoped,
  and mergeable back to trunk.
- Git worktrees are preferred for all change work, including OpenSpec proposal
  artifacts and implementation; use the `superpowers:using-git-worktrees` skill
  rather than hand-rolling a competing worktree process.
- Manual git worktrees should be created under `./.worktrees/<change-name>` from
  the repo root.

Do not duplicate Superpowers workflows in this file. If this file and a
Superpowers skill disagree about process mechanics, follow the user instruction
with the higher priority and call out the conflict.

## OpenSpec Usage

OpenSpec is the source of truth for intended system behavior.

Read `openspec/config.yaml` before product, schema, seed, migration, or
validation behavior changes. It defines the project context, global rules, and
the `superpowers-bridge` schema used by this repo.

Use:

- `openspec/config.yaml` for global project direction and constraints.
- `openspec/specs/*/spec.md` for accepted durable behavior when specs exist.
- `openspec/changes/*` for proposed behavior changes.
- `openspec/schemas/superpowers-bridge/` for the OpenSpec/Superpowers bridge.

If user-visible behavior, data shape, validation, migration behavior, seed
behavior, or generated contracts change, create or
update the appropriate OpenSpec change before implementation. Do not implement
first and backfill the spec later.

Create OpenSpec change artifacts from the change worktree, not from the main
checkout. Documentation-only edits, formatting, test-only refactors, and internal
refactors that preserve specified behavior can be direct PR-sized changes.

## Engineering Posture

Do not encode product decisions only in code, comments, tickets, pull requests,
or agent messages. If behavior matters, it belongs in OpenSpec.

Prefer the smallest complete solution. Every line of code, branch, function,
file, abstraction, dependency, configuration option, seed row, migration step,
and test helper must be necessary for the current outcome. If it can be removed
and the required outcome still works, remove it.

This is a fail-fast-and-loudly project. Do not guess, silently recover, report
partial success as success, skip invalid records without visibility, or continue
after a failed write as though the operation succeeded.

Fallback behavior must be explicitly required, visible, tested, documented, and
removable.

Backward compatibility is not the default for implementation changes. When a
contract, file shape, command behavior, schema, or data meaning changes, update
the implementation to require the new contract and fail loudly on the old one.
Add compatibility paths only when the user explicitly requires them, and cover
those paths with tests.

If project context, OpenSpec, existing code, and this file conflict, stop and
call out the conflict instead of guessing.

## Stable IDs

The database must never generate IDs for durable records. Every ID written by
migrations, seed data, data-loading scripts, or intake filing must be explicit
before the database write and stable across database resets.

Seed and migration IDs must be checked in directly. Imported records may use
canonical cuid2 IDs assigned by intake, but only through a durable source-name
mapping from source namespace plus source-provided ID or producer-derived
source-local name. See
`docs/adr/0008-resolve-canonical-ids-from-source-names.md`.

Do not use runtime ID generation for seeded records, including:

- `public.generate_cuid()`
- `gen_random_uuid()`
- `uuid_generate_v4()`
- serial/identity/default-generated IDs
- database column defaults that generate IDs
- matching by natural keys as a replacement for durable source-name mappings

If a seeded row will be referenced by another migration, seed block, link table,
build projection, or test fixture, generate the cuid2 once, commit it in the SQL
or data file, and reference that ID directly.

For imported records, use intake's persisted source-name mapping ledger to resolve
or assign canonical IDs before writing database rows. Prefer stable
source-provided IDs whenever they are available. When a new generated ID is
required, use `@paralleldrive/cuid2`. Do not use UUIDs for new IDs.

## Conflict-Free Seed Data

Seed data must be conflict-free. Do not add `ON CONFLICT`, upsert, or
`DO NOTHING` clauses to hide duplicate rows. A duplicate primary key, unique key,
slug, URL, or relationship should fail loudly during reset so the seed data can
be corrected.

Use explicit checked-in cuid2 IDs and direct foreign-key references. If a
conflict appears, fix the duplicated source row or reference; do not mask it with
idempotency.

Public-facing title fields in seed data must be clean reader-facing titles. Do
not include workflow, provenance, or processing prefixes such as "Processed
submitted report:" or "Third-party AI review:" in `reviews.title`; put
provenance/disclosure text in the report narrative or a dedicated disclosure
field.

`supabase/seed.sql` must insert complete rows directly. Do not add repair,
backfill, enrichment, or fix-up blocks that mutate seeded rows after insertion
when those values belong in the original `INSERT`. Prohibited seed patterns
include `WITH *_seed (...) AS (...) UPDATE public...`, end-of-seed schema
enforcement, post-insert required-field population, and split source-of-truth
maps for columns already present on the target table. Put required values in the
row being inserted and put schema constraints in migrations.

## Post-Seed Integrity Assertions

Seed data must run with normal database behavior. Do not use
`SET session_replication_role = 'replica'` and do not disable triggers unless a
specific exception is documented and approved. Start with zero disabled triggers;
fix seed order, duplicate data, and trigger side effects directly.

Post-seed integrity assertions must fail loudly on any orphaned foreign-key
relationship, missing expected seed row, slug or path mismatch, or zero-row
update that indicates expected data was not present. Do not rely on child rows,
later `UPDATE` statements, or application queries to reveal missing parent rows.

## Data and Evidence Rules

Raw source data, seed inputs, generated projections, import outputs, and derived
records are evidence-like material.

Preserve raw inputs and provenance when importing, transforming, or deriving
data. Keep rejected or incomplete records inspectable. Make manual corrections
explicit and auditable. Do not normalize away evidence.

Every derived record should be traceable to its source. If provenance is missing,
fail or mark the record incomplete; do not guess.

## Intake Envelopes And Workspace State

Every YAML envelope read or write must go through that envelope kind's
canonical IO instance. Do not hand-roll YAML parsing, validation,
serialization, file naming, or path conventions for envelopes. A directory is
not an envelope. If code reads or writes a YAML file with `apiVersion` and
`kind`, that `kind` must have canonical IO. If no canonical IO exists for that
`kind`, the read/write is invalid; either add canonical IO for that envelope
kind or remove the YAML file.

All intake YAML envelopes use `apiVersion: policeconduct.org/intake/v1alpha1`
and Kubernetes-style `kind`, `metadata`, and `spec` structure. `metadata.name`
and `metadata.namespace` are required. Do not use `metadata.id`,
`spec.source`, or `spec.entities`. `Command` is a shared envelope kind; command
folders are not envelopes, but any `Command` YAML file inside a command folder
must be read and written through shared `Command` IO.

Every envelope IO read, write, and constructor must reject a wrong
`apiVersion`, wrong `kind`, and any `spec` that does not exactly match that
kind's declared schema. Unknown envelope, metadata, and spec keys are rejected
unless they are inside an explicitly declared free-form payload field.

Source modules and tests must consume canonical YAML IO from `src/shared/io/`.
Do not import generated envelope internals or hand-roll YAML validation in
source modules. Plural typed artifact entries, singular record envelopes, and
create mutation envelopes that represent the same entity must share the same
singular spec. For example, `Agencies.spec.records.*.spec`, `Agency.spec`, and
`AgencyCreate.spec` all validate through `AgencySpec`.

The root intake module owns `$INTAKE_WORKSPACE/intake/`. Cross-command state
lives under `$INTAKE_WORKSPACE/intake/state/`. Namespace-scoped state lives
under `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/`, including the
reserved `manual` namespace for manually created envelopes that must survive
across commands. Command-local manual envelopes, such as `ArtifactMutation`,
belong in the command folder they affect.

Any kind-specific folder must use the exact kind value from the envelope or
record kind. Do not pluralize, kebab-case, lower-case, or otherwise transform
kind folder names.

## Command Pipelines

Every command pipeline must be built from explicit stages. A stage has a clear
name, a typed input, and a typed output. Prefer pure stages: given the same
input and context value, the stage returns the same output without reading or
writing external state.

When a stage needs a side effect, isolate that effect behind a narrow adapter
whose name states the effect. Examples include exact-kind envelope IO, database
CRU calls, command logging, geocoding calls, and intake state reads or writes.
Do not hide side effects inside transforms, generic helpers, broad services, or
objects reached through unrelated context.

Pipeline stages may depend only on their typed input and the narrow context or
adapter capability passed directly to them. Do not reach through object graphs
to find dependencies. Do not combine preparation, validation, IO, mutation
assembly, and persistence in one stage.

Resolver outputs may be cached and reused across imports only when the resolver
is pure for the cached input. For database entity properties, the reusable cache
subject is the canonical entity identity: `apiVersion`, canonical entity `kind`,
and canonical entity ID. The cache key must also include the target property
name. `spec.sources` is a map keyed by source namespace; each value stores the
source kind, source name, and a fingerprint of the typed source input as
provenance and invalidation evidence. Source evidence is not part of the cache
identity. This rule applies to every entity type.
Resolvers used by intake pipelines must be made pure and cacheable by declaring
all inputs needed to make the output deterministic. Do not introduce
non-cacheable resolver adapters for import preparation.

Any value that is resolved, derived, generated, or manually accepted to satisfy a
database row field is a resolved property unless it came directly from the source
artifact record. Resolved properties include slugs, address coordinates,
location-path IDs, postal-area decisions, and other prepared values. Every
resolved property must be read from and written to the intake-owned
`ResolvedProperty` cache through the pipeline's resolved-property adapter. Do
not return a bare resolved value and rely on callers to remember to cache it.
Make the easiest path the cached path: cache read, resolution, and cache write
belong in one function or explicit pipeline stage. If a value cannot be cached
with a canonical entity identity, target property, and source evidence, it is
not ready to be used by import preparation.

Agency coordinates and location paths are distinct data. `agency.latitude` and
`agency.longitude` are the point for the agency's own address. They must be
resolved from the agency address or another explicit agency-address coordinate
source. Do not populate agency latitude/longitude from a `location_path` row,
place centroid, county centroid, state centroid, map viewport, or other location
hierarchy geometry. `agency.location_path_id` identifies the canonical place in
the location hierarchy and may be resolved or created independently from the
agency address point.

## Dependencies

Do not add dependencies for hypothetical future needs. Keep dependency changes
scoped to the current task unless the user asks for a broader update. Remove
dependencies that are no longer necessary for the current outcome.

When adding or updating a dependency, check the current published version instead
of relying on memory.

## Validation

Prove changes with the narrowest validation that covers the risk.

For OpenSpec changes, run `npm run openspec:validate`.

For Supabase migrations or seed data, include validation that exercises reset,
migration, seed loading, and post-seed assertions when available. If a relevant
validation command cannot be run, report that clearly with the reason.

## Trunk-Based Development

Working in a git worktree is preferred for all changes, including documentation,
setup edits, OpenSpec proposal artifacts, and implementation, because it keeps
the main checkout clean and makes branch cleanup explicit.

When creating worktrees manually, use `./.worktrees/<change-name>` from the repo
root. Keep worktree names aligned with the branch or OpenSpec change name.
After creating or entering a worktree, run `npm run link-seed` to verify the
checkout is an active git worktree, confirm `supabase/seed.sql` is ignored, and
create the ignored symlink from another local worktree that already has it.
`./scripts/bootstrap-dev.sh` also checks and creates this link when needed.

Changes that do not modify behavior or outcome may be made directly on `main`
when the scope is small and reversible. Behavior changes, data-shape changes,
seed or migration changes, validation changes, and downstream contract changes
should use an isolated worktree.

The worktree setup and cleanup process belongs to Superpowers; this repo only
requires that isolation be considered and that branch work remains easy to merge
back to trunk.

Use Conventional Commit messages for all commits. See
`docs/adr/0007-use-conventional-commits.md` for accepted types and examples.
