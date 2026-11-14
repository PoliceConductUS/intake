# AGENTS.md

Project guidance for agents working in `intake`: the Supabase schema,
migrations, and intake CLI that load police-conduct data for the Institute for
Police Conduct, Inc. This file is self-contained; the longer rationale lives in
`docs/adr/` and, when the sibling checkout exists, in
`../engineering-standards/docs/`.

Each rule appears once. If this file, OpenSpec, and existing code disagree, stop
and say so instead of guessing.

## Scope Of A Change

Most bad changes in this repo are unrequested ones or designs nobody
approved. Hold this line first.

- Do exactly what was asked, with the narrowest change that fully produces the
  outcome. A direct request for a fix or implementation is approval for the
  scoped edits it needs; do not stop for a second approval round, and do not
  stop before the outcome is verified.
- Do not refactor, rename, reformat, re-order, delete, or "improve" code, tests,
  data, or docs the request does not require. When you notice something worth
  changing outside the request, report it after the work and wait.
- When a change needs a design decision (a new module, pipeline stage, table,
  envelope kind, or contract, or more than one reasonable approach), state the
  approach in a few lines and wait for approval before writing code. A small
  fix with one obvious implementation needs no design step.
- When finishing the request would need behavior nobody asked for (a new
  rule, policy, hook, exclusion, column, or special case, usually because the
  data does not fit), stop there. Report what blocks you and the options, and
  add nothing. Everything else, keep going until it is done.
- Stop and get approval before editing only when the change introduces an
  architectural compromise, weakens an invariant, changes data semantics,
  touches unrelated behavior, or has materially risky or ambiguous scope.
- When a requirement is ambiguous, take the smallest safe interpretation, state
  the assumption, and keep the change reversible. Ask only when a wrong
  assumption would cause meaningful harm. Do not invent requirements.
- Everything you add must be necessary for the current outcome: every line,
  branch, abstraction, option, dependency, migration step, and test helper. No
  code for imagined future needs.

## Reporting

- Use this project's words: its kinds, commands, and names. Do not coin a
  term. If something new must be named, define it in the same sentence.
- End a work report with the state: worktree and branch, what is committed,
  what is pushed, what is merged, and what is left to do.

## Principles

- **Fix the cause; never hide the evidence.** (Dale Lotts's explicit working
  preference.) Never suppress a warning, error, or failing check to make a
  problem look resolved. Fix what produced it.
- **Outcome first.** Start from the user or system outcome, define the
  observable behavior, then work inward to the smallest implementation.
- **Fail fast and loudly.** These records are evidence about real officers; a
  silent skip is a missing record nobody knows about. Do not guess, silently
  recover, report partial success as success, skip invalid records without
  visibility, or continue after a failed write.
- **No fallbacks and no backward compatibility.** When a contract, file shape,
  command, schema, or data meaning changes, require the new one and fail loudly
  on the old one.
- **No special cases by namespace, entity type, or source ID.** Do not branch,
  dispatch a hook, or embed a correction rule on any of them. A correction is
  workspace data, written through the shared CLI and applied uniformly by the
  shared pipeline. No source-specific correction stages or checked-in cache
  seeds.

## Workflow

- **OpenSpec is the source of truth for intended behavior.** Read
  `openspec/config.yaml` before changing product, schema, migration, or
  validation behavior. Accepted behavior is in `openspec/specs/*/spec.md`;
  proposals are in `openspec/changes/*`. If user-visible behavior, data shape,
  validation, migration behavior, or a generated contract changes, create or
  update the OpenSpec change first, from the change worktree. Do not implement
  first and backfill the spec. Behavior that matters belongs in OpenSpec, not
  only in code, comments, tickets, or agent messages.
- **No OpenSpec change is needed** for documentation, formatting, test-only
  refactors, or internal refactors that preserve specified behavior.
- **Superpowers governs how work is executed** (planning, TDD, debugging,
  review, verification, worktrees). Do not duplicate its workflows here; if it
  conflicts with this file, follow the higher-priority user instruction and
  name the conflict.
- **One worktree, one branch.** Only one worktree and branch may be active for
  this repo at a time, because changes get lost across parallel branches.
  Reuse the current worktree and branch for new work; never create another
  without the user's explicit permission. Behavior, data-shape, migration,
  validation, and contract changes go in that worktree, under
  `./.worktrees/<change-name>`. Small reversible changes that do not alter
  behavior may go directly on `main`. Keep the branch short-lived and
  mergeable.
- **Commits** use Conventional Commits (`docs/adr/0007`).

## Stable IDs

Published URLs, slugs, and cross-record references depend on IDs that survive a
database reset, so the database never generates an ID for a durable record
(`docs/adr/0008`).

- Every ID is explicit before the write and identical across runs, content
  changes, and lifecycle changes. A change in status, resolution, retirement,
  or reactivation never creates a new identity. This covers every record type,
  including annotations, and every producer: manual, source, and root intake.
- Migration IDs are checked in directly. If a row will be referenced elsewhere,
  generate the cuid2 once, commit it, and reference it directly.
- Imported records resolve or receive their canonical cuid2 through intake's
  persisted source-name mapping (source namespace plus the source-provided ID
  or producer-derived source-local name) before any row is written. Prefer the
  source-provided ID when one exists.
- A changed or newly minted ID or slug for an existing record is a defect to
  fix, never an acceptable difference to report.
- New IDs come from `@paralleldrive/cuid2`. Never use a UUID, a run timestamp,
  a per-run ID, `public.generate_cuid()`, `gen_random_uuid()`,
  `uuid_generate_v4()`, a serial/identity column, or an ID-generating column
  default. Never match on natural keys in place of the source-name mapping.

## Database Writes

- **One write path.** Persisted data reaches the database only through
  canonical envelopes and recorded mutations, for manual, source-produced, and
  root-intake records alike. No direct SQL writes, post-apply scans, or special
  persistence hooks.
- **`data generate` calculates; `data up` applies.** `up` applies
  already-recorded mutations and tracks them in the chain ledger
  (`docs/adr/0033`). It is fully idempotent, changes nothing when nothing is
  pending, and never calculates records, findings, corrections, annotation
  resolutions, or IDs. A validation change needs a normal generation first.
- **Compare, then write.** An existing imported row is compared with the
  supplied source fields. Unchanged input is a no-op only after that
  comparison; changed input produces an update or a visible error. A stable ID
  does not make content immutable. Do not use `upsert: "read"`, unconditional
  reads, or existence-only skips to make a rerun look idempotent or to get past
  a validation or comparison failure. Explicit read/assertion operations are
  separate from importing source changes.
- **Duplicates fail.** Do not add `ON CONFLICT`, upsert, or `DO NOTHING` to
  absorb a duplicate key, slug, URL, or relationship. Fix the duplicated row or
  reference.
- **Normal database behavior.** Do not disable triggers or set
  `session_replication_role = 'replica'` without a documented, approved
  exception. Fix load order, duplicates, and trigger side effects directly.
- **Integrity checks fail loudly** on an orphaned foreign key, a missing
  expected row, a slug or path mismatch, or a zero-row update that shows
  expected data was absent.
- **Public titles are reader-facing.** `reviews.title` carries no workflow or
  provenance prefix such as "Processed submitted report:" or "Third-party AI
  review:"; disclosure text goes in the narrative or a disclosure field.
- **`supabase/seed.sql` is retired.** `db reset` no longer loads it and it is
  not a way to get data into a database; supply data through an intake source
  or the mutation chain. While the file exists as the legacy record, any edit
  inserts complete rows with explicit IDs: no post-insert `UPDATE`, backfill,
  or fix-up blocks, and no split source-of-truth maps.

## Evidence And Provenance

Raw source data, generated projections, import outputs, and derived records are
evidence-like material.

- Preserve raw inputs and provenance through every import and transform. Do not
  normalize evidence away.
- Keep rejected and incomplete records inspectable, and manual corrections
  explicit and auditable.
- Every derived record traces to its source. If provenance is missing, fail or
  mark the record incomplete.

## Cache Changes

Every cache change goes through the intake CLI, including correction messages,
evidence, values, and other metadata, so command provenance and correction
history are kept. Do not edit cache files or call cache or correction writers
from an ad hoc script. Manual corrections use `cache set` or `cache unset` with
the required `--message`. If the CLI lacks an operation, implement and validate
that CLI capability first, then invoke it. Normal pipeline stages may use their
internal cache adapters.

## Envelopes And Workspace State

- **Shape.** Every intake YAML envelope uses
  `apiVersion: policeconduct.org/intake/v1alpha1` with Kubernetes-style `kind`,
  `metadata`, and `spec`. `metadata.name` and `metadata.namespace` are
  required. `metadata.id`, `spec.source`, and `spec.entities` are not used.
- **Canonical IO only.** Every envelope read or write goes through that kind's
  canonical IO from `src/shared/io/`. Do not hand-roll YAML parsing,
  validation, serialization, file naming, or paths, and do not import generated
  envelope internals. A YAML file with `apiVersion` and `kind` whose kind has
  no canonical IO is invalid: add the IO or remove the file.
- **Strict validation.** Every IO read, write, and constructor rejects a wrong
  `apiVersion`, a wrong `kind`, and any `spec` that does not exactly match the
  declared schema. Unknown keys are rejected outside an explicitly declared
  free-form payload field.
- **One spec per entity.** Plural artifact entries, singular record envelopes,
  and create-mutation envelopes for the same entity share one singular spec:
  `Agencies.spec.records.*.spec`, `Agency.spec`, and `AgencyCreate.spec` all
  validate through `AgencySpec`.
- **Folders.** A directory is not an envelope. A kind-specific folder uses the
  exact kind value, never pluralized, kebab-cased, or lower-cased. `Command` is
  a shared kind; a `Command` YAML file inside a command folder goes through
  shared `Command` IO.
- **State.** The root intake module owns `$INTAKE_WORKSPACE/intake/`.
  Cross-command state lives in `intake/state/`; namespace-scoped state in
  `intake/state/namespaces/<namespace>/`, including the reserved `manual`
  namespace for manually created envelopes that must survive across commands.
  Command-local manual envelopes such as `ArtifactMutation` stay in the command
  folder they affect.

## Command Pipelines

- **Explicit stages.** A pipeline is built from named stages with a typed input
  and a typed output. Prefer pure stages. A stage depends only on its typed
  input and the narrow context or adapter passed directly to it; do not reach
  through object graphs for dependencies. Do not combine preparation,
  validation, IO, mutation assembly, and persistence in one stage.
- **Named side effects.** A side effect sits behind a narrow adapter whose name
  states the effect: exact-kind envelope IO, database CRU calls, command
  logging, geocoding, intake state reads or writes. Do not hide effects in
  transforms, generic helpers, or broad services.
- **Resolved properties are cached.** Any value resolved, derived, generated,
  or manually accepted to fill a database field, rather than taken directly
  from the source artifact record, is a resolved property: slugs, address
  coordinates, location-path IDs, postal-area decisions. Read and write it
  through the pipeline's `ResolvedProperty` adapter, with cache read,
  resolution, and cache write in one function or stage. Never return a bare
  resolved value for the caller to remember to cache.
- **Cache identity.** The cache subject is the canonical entity identity
  (`apiVersion`, canonical `kind`, canonical ID); the key adds the target
  property name. `spec.sources` is keyed by source namespace and records source
  kind, source name, and a fingerprint of the typed source input as provenance
  and invalidation evidence; it is not part of the identity. This holds for
  every entity type. A value that cannot be cached this way is not ready for
  import preparation.
- **Pure resolvers.** A resolver declares every input needed to make its output
  deterministic, so its output can be cached and reused across imports. Do not
  add a non-cacheable resolver adapter to import preparation.
- **Agency point versus place.** `agency.latitude` and `agency.longitude` are
  the point of the agency's own address, resolved from that address or another
  explicit agency-address coordinate source. Never fill them from a
  `location_path` row, a place, county, or state centroid, a map viewport, or
  other hierarchy geometry. `agency.location_path_id` names the canonical place
  and is resolved independently.

## Dependencies

Add or update a dependency only for the current task, after checking its
current published version. Remove a dependency your change makes unnecessary.

## Validation

- `npm run validate` is the gate: formatting, typecheck, tests, build, and
  OpenSpec validation. The pre-commit hook and CI both run it. Do not bypass it
  with `--no-verify`, and do not weaken a check to get through it.
- `test/architecture.test.ts` enforces the rules above that can be checked
  mechanically. When a rule is broken in a way a test could have caught, add
  the test there.
- Never edit a file marked `Generated by ... Do not edit`. Change its
  generator or templates and run `npm run generate:envelope-types` or
  `npm run generate:data-request-doc`.
- While developing, prove a change with the narrowest check that covers the
  risk. Migration changes need a reset that applies every migration.
- If a relevant check cannot be run, say so plainly and give the reason.
