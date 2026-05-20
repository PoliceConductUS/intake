# intake

Deterministic data intake for the Institute for Police Conduct, Inc.

This repository is one link in the Institute for Police Conduct, Inc. data
ingestion pipeline. It accepts versioned intake packages produced by upstream
source-specific processes, validates them, files them into an intake-owned
archive, preserves raw and transformed artifacts, and loads deterministic derived
state into Supabase/Postgres.

The database schema and migrations currently live under `supabase/` and will
remain there for now. The existing `supabase/seed.sql` can populate the current
schema, but it is transitional and known to be the wrong long-term loading
model. The target state is to move away from `seed.sql` as quickly as practical:
database loading and reset should be driven from accepted archived intake
packages.

The intake package contract is modeled after Kubernetes-style manifests:

```yaml
apiVersion: policeconduct.org/v1alpha1
kind: IntakePackage
metadata:
  id: c... # stable package cuid2 assigned upstream
  name: texas-tcole-roster-2026-05-19
  producedAt: 2026-05-19T12:00:00Z
  producer: texas-tcole-importer
spec:
  source:
    namespace: texas-tcole-roster
    jurisdiction: TX
  artifacts:
    raw:
      - uri: s3://upstream-bucket/path/officers.csv
        sha256: ...
        mediaType: text/csv
    transformed:
      - uri: s3://upstream-bucket/path/officers.normalized.jsonl
        sha256: ...
        mediaType: application/jsonl
    entities:
      - kind: officer
        uri: s3://upstream-bucket/path/officers.entities.jsonl
        sha256: ...
        mediaType: application/jsonl
```

The manifest can point to local files, S3 objects, or URLs. It must not reference
the intake archive directly; archive layout and storage are owned by this repo.

Initial CLI vocabulary:

```bash
intake validate <manifest-ref>
intake file <manifest-ref>
intake reset
intake audit
```

- `validate` checks schema, artifact reachability, checksums, source identity,
  and provenance without changing archive or database state.
- `file` accepts a valid package into the official intake record, copies
  artifacts into intake-owned archive storage, records package/file digests, and
  loads deterministic derived state. It always runs the full validation gate
  before making archive or database changes.
- `reset` rebuilds derived state from the accepted archive/package index and
  source-key mapping ledger only.
- `audit` verifies archived manifests and artifacts still match recorded
  digests.

Core invariants:

- Intake is idempotent.
- Raw source artifacts are preserved unchanged.
- Post-transformation artifacts are preserved.
- Archive snapshots are write/append-only.
- Package IDs are explicit upstream-supplied cuid2 text IDs.
- Records carry stable source identity: source namespace plus source-provided ID
  or producer-derived source-local key.
- Intake maps source identity to canonical cuid2 IDs. New mappings are assigned
  by intake before database writes and persisted for reset/replay.
- The database must never generate IDs for durable records.
- Package IDs are stable across time; re-filing the same package ID with changed
  content is rejected.
- Intake can completely reconstruct derived state from accepted archived
  packages and the source-key mapping ledger.

See `docs/adr/` for the durable architecture decisions behind this scope.

## Candidate Upstream Package Producers

The first upstream package producer to explore is Tempe's Police Transparency
arrest dataset:

- [Police Transparency - Arrests - All Data (related tables / normalized)](https://data.tempe.gov/maps/tempegov::police-transparency-arrests-all-data-related-tables-normalized/about)

That producer should be a separate source-specific CLI/tool that creates
`IntakePackage` manifests and artifacts for this repo to validate and file. The
producer should preserve the original source data and be able to regenerate its
package from source inputs.

Upstream producers should pass through source-provided stable IDs when present.
When a source does not provide stable IDs, the producer should derive stable
source-local keys. Intake can export feedback artifacts, such as source-key to
canonical-ID mappings, rejected record reasons, slugs, and duplicate decisions,
so later producer runs can be more consistent without making producer-local
caches the source of truth.

Audit the Audit is also a desirable source of related links and references. It
is useful for experimenting with packages that add related links to officers and
agencies, including cases where the referenced officer or agency is not already
present in the database. If the package contains enough evidence to establish
that the related entity is valid, intake should be able to create that related
entity as part of filing the package.

## New Developer Quickstart

From a fresh clone on macOS or Linux:

```bash
./scripts/bootstrap-dev.sh
```

The bootstrap script installs or verifies the local development toolchain as far
as it can from the terminal:

- Homebrew, when it is missing and the platform supports the official installer
- Git
- Homebrew dependencies from `Brewfile`
- mise
- mise trust for this repo's `mise.toml`
- mise-managed tools from `mise.toml`, including Node.js, GitHub CLI, and uv
- project npm dependencies, including local OpenSpec and Supabase CLI packages
- Docker / Docker Desktop installation when possible
- ignored `supabase/seed.sql` availability, including linking from another local
  worktree when one already has the file
- OpenSpec validation
- Supabase CLI availability
- Codex App or Codex CLI presence
- Superpowers agent setup guidance for Codex App

The script checks everything first, then prints a summary of what is already
available, what is missing and installable, and what needs manual follow-up. If
anything installable is missing, it also prints the actual install commands it
will run before asking once for approval. Answer `y` to install or `q` to quit.
For non-interactive setup, run:

```bash
./scripts/bootstrap-dev.sh --yes
```

Docker still needs a running daemon. On macOS, start Docker Desktop after the
script installs it, then run:

```bash
npm run doctor
```

`npm run doctor` runs the same checks without intentionally installing missing
tools. It also verifies environment readiness that cannot be completed by
installing packages alone, including GitHub CLI authentication. If it reports
that `mise.toml` is not trusted, run the printed `mise trust` command and then
rerun `npm run doctor`. If it reports that GitHub CLI is not authenticated, run:

```bash
mise exec -- gh auth login
npm run doctor
```

## Contents

- `supabase/config.toml` - Supabase local development configuration
- `supabase/migrations/` - database migrations
- `supabase/seed.sql` - transitional seed data for the current schema; replace
  with archive-driven reset/load. This file is ignored because it is large; the
  bootstrap script or `npm run link-seed` can link it from another local worktree
  when available. `npm run link-seed` also verifies the checkout is an active git
  worktree and that `supabase/seed.sql` is ignored before creating the link.
- `openspec/` - OpenSpec project configuration using the `superpowers-bridge` schema
- `docs/adr/` - durable architecture decisions
- `mise.toml` - mise-managed tool versions and shared environment variables
- `Brewfile` - Homebrew-managed system bootstrap dependencies
- `scripts/bootstrap-dev.sh` - macOS/Linux development environment bootstrap

Local Supabase state such as `supabase/.temp/` and `supabase/.branches/` is intentionally ignored and was not copied.

## Commands

Run this to see every available npm script:

```bash
npm run
```

```bash
npm run setup
npm run doctor
npm run setup -- --yes
npm run link-seed
npm run format
npm run format:sql
npm run lint
npm run lint:sql
npm run test
npm run validate
npm run openspec:status
npm run openspec:validate
npm run supabase:start
npm run supabase:reset
npm run supabase:stop
```

The OpenSpec and Supabase CLI commands are installed as local npm dev
dependencies. Use the npm scripts above instead of relying on globally installed
CLIs.

`npm run validate` is the aggregate check for this repo. It runs formatting
checks, shell linting, typechecking, Vitest, build, and OpenSpec validation.
`npm test` runs the Vitest test suite.

`mise` owns pinned tool versions and shared environment, including Node.js,
GitHub CLI, uv, SQLFluff cache locations, and Supabase telemetry defaults. npm
remains the primary workflow surface for this repo. `scripts/bootstrap-dev.sh`
still exists because mise does not replace first-run workstation setup: it checks
and installs Homebrew-managed system tools, trusts this repo's `mise.toml`,
installs mise-managed tools, installs npm dependencies, verifies GitHub CLI
authentication, checks Docker readiness, verifies local OpenSpec/Supabase CLI
packages, and prints any manual follow-up needed before development starts.

SQL formatting uses SQLFluff through `uvx`, so the repo does not need a checked
in Python virtual environment. SQLFluff is Python-based, but `uvx` handles the
tool environment and can use uv-managed Python when needed. `format:sql` and
`lint:sql` target every SQL file SQLFluff finds in the repo, including
`supabase/seed.sql`; review generated seed-data diffs carefully before deciding
what to commit. SQL lint is available as a separate job because the current
checked-in SQL has existing style debt; add it to `validate` after the SQL
baseline is cleaned.

## OpenSpec, Superpowers, and the Bridge

This repo uses Codex App, OpenSpec, Superpowers, and the
`superpowers-bridge` schema together:

- **Codex App** is the AI coding assistant. You talk to it in a thread, and it
  can read files, edit files, and run commands in this repo.
- **OpenSpec** is the place where intended behavior is written down before code
  changes. It keeps decisions out of fragile chat history.
- **Superpowers** is a set of agent workflows Codex can use for brainstorming,
  planning, test-driven work, debugging, review, worktrees, and verification.
- **The bridge** tells OpenSpec and Superpowers how to work together in this
  repo so design, plan, verification, and retrospective artifacts stay under the
  OpenSpec change directory.

- OpenSpec config: `openspec/config.yaml`
- Bridge schema: `openspec/schemas/superpowers-bridge/`
- Agent rules: `AGENTS.md`

OpenSpec references:

- [OpenSpec project](https://github.com/Fission-AI/OpenSpec)
- [OPSX workflow docs](https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md)
- [OpenSpec command docs](https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md)
- [OpenSpec workflow docs](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)
- [Supported tools](https://github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md)

For behavior changes, write OpenSpec change artifacts before implementation. The
bridge keeps Superpowers brainstorming and planning output in the OpenSpec change
directory instead of creating duplicate `docs/superpowers/` artifacts.

Superpowers is available through the coding agent, not this npm package. In
Codex App, confirm the active session has the Superpowers skills listed in the
tool/skill context before doing behavior-changing work. If those skills are not
available, stop and use a Codex session or configuration where Superpowers is
enabled.

## Change Workflow

Use the shared Institute for Police Conduct engineering standards for the
general Codex/OpenSpec/Superpowers workflow:

- [AI-assisted development](../engineering-standards/docs/ai-assisted-development.md)
- [Engineering principles](../engineering-standards/docs/engineering-principles.md)
- [Contribution and review](../engineering-standards/docs/contribution-and-review.md)
- [Project setup standard](../engineering-standards/docs/project-setup-standard.md)

Repo-specific setup and verification:

```bash
npm run doctor
npm run openspec:validate
npx openspec schemas
npx openspec status
```

Expected state:

- `npm run doctor` reports Codex App or Codex CLI as available, verifies the
  mise-managed tools, and fails loudly if GitHub CLI still needs
  `mise exec -- gh auth login`.
- `npx openspec schemas` includes `superpowers-bridge (project)`.
- `/opsx` commands and Superpowers skills are available in the active Codex
  session.

OpenSpec details for this repo:

- Config: `openspec/config.yaml`
- Bridge schema: `openspec/schemas/superpowers-bridge/`
- Change directories: `openspec/changes/<change-name>/`

Use OpenSpec for behavior, data-shape, validation, workflow, and downstream
contract changes. Direct PR-sized edits are acceptable for documentation-only
updates, formatting, tooling tweaks, and refactors that preserve specified
behavior.

Manual worktrees should live under `./.worktrees/<change-name>` from the repo
root:

```bash
mkdir -p .worktrees
git worktree add .worktrees/<change-name> -b <change-name>
```

Run `npm run supabase:reset` when migrations, seed data, database constraints,
or post-seed assertions changed. Docker must be running first.

Commit messages must use Conventional Commits. See
`docs/adr/0007-use-conventional-commits.md`.

## Seed Data Rules

Follow `AGENTS.md` for stable ID, conflict-free seed data, and post-seed
integrity requirements while `supabase/seed.sql` exists. In short: use checked-in
stable IDs, let duplicates fail loudly, and add assertions for expected rows and
relationships.

`supabase/seed.sql` is not the target data-loading model. New intake behavior
should move the project toward archive- and mapping-ledger-driven `intake file`
and `intake reset` instead of expanding seed-based loading.
