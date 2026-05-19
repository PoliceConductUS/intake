# AGENTS.md

## Purpose

This file defines project-specific guidance for agents working in this repository.

`intake` contains Supabase schema, migrations, and seed data for the Institute
for Police Conduct, Inc. The development style is outcome-driven, direct,
evidence-based, and hostile to speculative complexity.

Use this file for repository doctrine. Use Superpowers for execution discipline,
including brainstorming, planning, TDD, debugging, review, verification, branch
finishing, and worktree setup.

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

## No Hidden Product Decisions

Do not encode product decisions only in code, comments, tickets, pull requests,
or agent messages. If behavior matters, it belongs in OpenSpec.

Examples of hidden product decisions:

- stricter validation than requested
- silently normalizing user input
- adding required fields
- changing command, API, seed, or migration semantics
- adding fallback behavior
- choosing a durable persistence or provenance model

If project context, OpenSpec, existing code, and this file conflict, stop and
call out the conflict instead of guessing.

## Simplicity Rules

Prefer the smallest complete solution. Small means focused, understandable,
testable, and shippable.

Every line of code, branch, function, file, abstraction, dependency,
configuration option, seed row, migration step, and test helper must be necessary
for the current outcome. If it can be removed and the required outcome still
works, remove it.

Do not add generic frameworks, plugin systems, configuration layers, queues,
caches, retries, compatibility shims, or extension points unless the current
outcome requires them.

## No Silent Fallback

This is a fail-fast-and-loudly project.

Do not guess. Do not silently recover. Do not report partial success as success.
Do not skip invalid records without making that visible. Do not continue after a
failed write as though the operation succeeded.

Allowed fallback behavior must be explicitly required, visible, tested,
documented, and removable.

## Stable IDs

The database must never generate IDs for durable records. Every ID written by
migrations, seed data, data-loading scripts, or intake filing must be explicit
before the database write and stable across database resets.

Seed and migration IDs must be checked in directly. Imported records may use
canonical cuid2 IDs assigned by intake, but only through a durable source-key
mapping from source namespace plus source-provided ID or producer-derived
source-local key. See
`docs/adr/0008-resolve-canonical-ids-from-source-keys.md`.

Do not use runtime ID generation for seeded records, including:

- `public.generate_cuid()`
- `gen_random_uuid()`
- `uuid_generate_v4()`
- serial/identity/default-generated IDs
- database column defaults that generate IDs
- matching by natural keys as a replacement for durable source-key mappings

If a seeded row will be referenced by another migration, seed block, link table,
build projection, or test fixture, generate the cuid2 once, commit it in the SQL
or data file, and reference that ID directly.

For imported records, use intake's persisted source-key mapping ledger to resolve
or assign canonical IDs before writing database rows.

## Conflict-Free Seed Data

Seed data must be conflict-free. Do not add `ON CONFLICT`, upsert, or
`DO NOTHING` clauses to hide duplicate rows. A duplicate primary key, unique key,
slug, URL, or relationship should fail loudly during reset so the seed data can
be corrected.

Use explicit checked-in cuid2 IDs and direct foreign-key references. If a
conflict appears, fix the duplicated source row or reference; do not mask it with
idempotency.

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

Keep work scoped and short-lived. Prefer small branches from trunk, frequent
integration, and direct fixes over long-running feature branches. Avoid broad
refactors mixed with behavior changes.

Working in a git worktree is preferred for all changes, including documentation,
setup edits, OpenSpec proposal artifacts, and implementation, because it keeps
the main checkout clean and makes branch cleanup explicit.

When creating worktrees manually, use `./.worktrees/<change-name>` from the repo
root. Keep worktree names aligned with the branch or OpenSpec change name.

Changes that do not modify behavior or outcome may be made directly on `main`
when the scope is small and reversible. Behavior changes, data-shape changes,
seed or migration changes, validation changes, and downstream contract changes
should use an isolated worktree.

The worktree setup and cleanup process belongs to Superpowers; this repo only
requires that isolation be considered and that branch work remains easy to merge
back to trunk.

Use Conventional Commit messages for all commits. See
`docs/adr/0007-use-conventional-commits.md` for accepted types and examples.
