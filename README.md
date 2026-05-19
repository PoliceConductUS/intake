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
- Homebrew dependencies from `Brewfile`
- Git
- nvm
- uv for Python-based developer tools such as SQLFluff
- the latest Node.js LTS from `.nvmrc`
- project npm dependencies, including local OpenSpec and Supabase CLI packages
- Docker / Docker Desktop installation when possible
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
tools.

## Contents

- `supabase/config.toml` - Supabase local development configuration
- `supabase/migrations/` - database migrations
- `supabase/seed.sql` - transitional seed data for the current schema; replace
  with archive-driven reset/load
- `openspec/` - OpenSpec project configuration using the `superpowers-bridge` schema
- `docs/adr/` - durable architecture decisions
- `.nvmrc` - Node.js LTS selector for nvm
- `Brewfile` - Homebrew-managed development tools
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
checks, shell linting, and OpenSpec validation. `npm test` delegates to
`npm run validate` until the repo has a separate test suite.

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

## OpenSpec Primer

OpenSpec is a lightweight way to make the AI and the developer agree on what is
being built before files are changed.

Without OpenSpec, an AI assistant may rely on the latest chat messages and start
editing code before the desired behavior is clear. With OpenSpec, the expected
behavior is written into repo files first. Those files can be reviewed, changed,
committed, and used later as documentation.

The main unit is a change directory:

```text
openspec/changes/<change-name>/
```

A change directory can contain:

- `brainstorm.md` - design exploration captured by the bridge when needed
- `proposal.md` - why the change exists and what outcome it targets
- `design.md` - technical approach for changes that need design explanation
- `specs/<capability>/spec.md` - proposed requirement changes
- `tasks.md` - implementation checklist
- `plan.md` - Superpowers execution plan created by the bridge
- `verify.md` - post-implementation verification evidence
- `retrospective.md` - evidence-based review before archive

In this repo, `openspec/config.yaml` sets `schema: superpowers-bridge`, so new
changes use the bridge by default. That means OpenSpec describes the desired
behavior, and Superpowers guides how Codex should discuss, plan, implement,
review, and verify the work.

Important commands:

- `/opsx:new <change-name>` starts a new folder under
  `openspec/changes/<change-name>/`.
- `/opsx:continue <change-name>` asks Codex to create the next missing document
  for that change. Early on, that might be a brainstorm or proposal. Later it
  might be specs, tasks, a detailed plan, or a retrospective. You run it more
  than once because the change is built up one document at a time.
- `/opsx:apply <change-name>` asks Codex to implement the approved plan.
- `/opsx:verify <change-name>` asks Codex to record evidence that the
  implementation matches the OpenSpec artifacts.
- `/opsx:archive <change-name>` moves the completed change to
  `openspec/changes/archive/` and updates the durable specs.

Use OpenSpec for behavior, data-shape, validation, workflow, and downstream
contract changes. Direct PR-sized edits are acceptable for documentation-only
updates, formatting, tooling tweaks, and refactors that preserve specified
behavior.

## Codex App Change Lifecycle

Use this flow for behavior changes, database shape changes, seed-data changes,
validation changes, or anything that affects downstream app contracts.

### 1. Verify Codex and OpenSpec Integration

Open the repo root in Codex App and make sure the thread is working from this
directory:

```bash
pwd
npm run doctor
npm run openspec:validate
npx openspec schemas
npx openspec status
```

Expected state:

- Codex has read `AGENTS.md`; that file tells the agent how this repo expects
  work to be done.
- `npm run doctor` reports Codex App or Codex CLI as available, or lists Codex
  App as a manual follow-up to install/open.
- `npm run doctor` completes, with only manual Docker/Superpowers follow-ups if
  those are not currently running inside the shell.
- `npm run openspec:validate` exits successfully.
- `npx openspec schemas` includes `superpowers-bridge (project)`, which means
  OpenSpec found this repo's bridge schema and will use it as the project
  schema for new changes.
- The active Codex session has Superpowers skills available. In Codex App, these
  appear in the tool/skill context. If they are missing, stop and use a Codex
  session where Superpowers is enabled.
- `/opsx` commands are part of the active Codex session and are used for the
  OpenSpec workflow.

### 2. Brainstorm the Outcome

Start in Codex with a normal conversation about the outcome, not a command to
edit files. The point of this phase is to make the change smaller, clearer, and
more testable before OpenSpec or implementation work begins.

A useful first prompt is concrete and conversational:

```text
I want to brainstorm <the outcome I want>.

Please help me make this smaller before we write code:

- What is the first useful slice?
- What can we remove or postpone?
- What decisions would make this easier to test?
- Does this need backward compatibility, or can we make a clean break?
- What user-visible behavior should prove the change worked?

Do not edit files yet. I want to settle the scope first, then turn the result
into an OpenSpec change.
```

For example:

```text
I want to brainstorm the first useful CLI feature for this repo.

The goal is to make intake packages safer and easier to work with. Please help
me compare starting with `intake validate <manifest-ref>` versus
`intake file <manifest-ref>`.

Do not edit code yet. I want to understand the tradeoffs, choose the smallest
useful first feature, and then turn that into an OpenSpec change.
```

At this stage, Codex should ask questions, challenge scope, and help narrow the
outcome. Good brainstorming should explicitly cover what is out of scope,
whether existing behavior must keep working, what data or API contracts are
allowed to change, and how a developer will know the outcome has been achieved.

Keep brainstorming verbal until scope is stable. A change is ready to promote
when the scope is locked, major design forks are resolved, dependencies are
mapped, acceptance criteria are concrete, and recent turns are confirmations
rather than new alternatives.

#### How to Talk to Codex During Brainstorming

Do not over-control the AI with step-by-step implementation instructions. That
usually produces worse outcomes because Codex starts optimizing for your
suggested steps instead of the project outcome. Prefer telling Codex the goal,
constraints, examples, and acceptance criteria, then ask it to identify the
smallest useful path.

Useful instructions:

- "Compare these two approaches and recommend the smallest useful first slice."
- "What can we remove or postpone?"
- "What assumptions are risky?"
- "What tests would prove this works?"
- "This must not preserve backward compatibility unless we explicitly decide it
  should."
- "Review the current docs and tell me what is missing before implementation."

Vague concepts are hard for AI to use reliably. Instead of saying "make it
robust", say what failure modes must be handled. Instead of "make it simple",
say what should be removed or what the first supported workflow is. Instead of
"make it production-ready", list the checks, error cases, data guarantees, and
operator behavior that matter for this change.

### 3. Create a Worktree for the Change

Before creating the OpenSpec change, create or switch to a worktree for the
change. Keep the main checkout clean even while writing proposal/spec/task
artifacts.

Tell Codex explicitly:

```text
Start <change-name> in a git worktree before creating OpenSpec artifacts.
```

Manual worktrees should live under `./.worktrees/<change-name>` from the repo
root. To create one yourself:

```bash
mkdir -p .worktrees
git worktree add .worktrees/<change-name> -b <change-name>
```

### 4. Propose the OpenSpec Change

Ask Codex to create the OpenSpec change before implementation:

```text
Turn this brainstorm into an OpenSpec change named <change-name>. Do not implement yet.
```

That conversational request matters. After brainstorming, Codex has the context
needed to turn the discussion into useful proposal/spec/task artifacts.
`/opsx:new <change-name>` by itself only starts the change structure; it does not
carry the brainstormed decisions into the docs.

After Codex creates the change, use `/opsx:continue <change-name>` whenever the
next OpenSpec artifact is ready to be generated or refined:

```text
/opsx:continue <change-name>
```

Think of `/opsx:continue` as "Codex, do the next OpenSpec paperwork step for
this change." The first call may create a brainstorm document. The next may
create a proposal. Later calls may create requirements, tasks, or the execution
plan. Codex decides which document is next by looking at what already exists in
`openspec/changes/<change-name>/` and what the bridge schema says should come
next.

Run `/opsx:continue <change-name>` repeatedly because this keeps the change
reviewable. After each generated artifact, inspect it, ask Codex to revise it,
or stop before moving deeper into implementation.

If you are not sure what to do next, ask Codex directly:

```text
What's next?
```

or:

```text
What's next in the Superpowers/OpenSpec flow?
```

Codex should look at the current change state and tell you whether to continue
brainstorming, generate another OpenSpec artifact, review docs, apply, verify,
write the retrospective, archive, or merge.

Review the files under `openspec/changes/<change-name>/` before apply. Look for
missing acceptance criteria, vague requirements, untested behavior, unnecessary
scope, accidental backward compatibility promises, missing tasks, and tests that
do not connect back to the proposed behavior.

Ask Codex for corrections by describing the gap, not by manually dictating every
edit. Codex can connect related proposal, spec, task, plan, and test updates
when it understands the outcome:

```text
Review openspec/changes/<change-name>. Is anything missing or inconsistent
before apply? If so, update the related proposal/spec/tasks/plan artifacts
together. Do not implement yet.
```

Continue until the change has the needed proposal/spec/tasks/plan artifacts.
Validate before implementation:

```bash
npm run openspec:validate
npx openspec status
```

Commit the OpenSpec artifacts once the proposal/spec/tasks/plan are coherent and
before implementation begins:

```bash
git add -A
git commit -m "docs: propose <change-name>"
```

### 5. Apply, Verify, and Commit

Implementation continues in the same worktree where the OpenSpec proposal was
created. The bridge apply phase is expected to use
`superpowers:subagent-driven-development`.

```text
/opsx:apply <change-name>
```

During apply, Codex should implement from the OpenSpec plan, keep tasks updated,
and run the relevant validation for the risk. For this repo, common checks are:

```bash
npm run openspec:validate
npm run supabase:reset
```

Use `npm run supabase:reset` when migrations, seed data, database constraints,
or post-seed assertions changed. Docker must be running first.

Commit implementation work after tests and validation pass:

```bash
git add <changed-files>
git commit -m "feat: implement <change-name>"
```

Use `fix:` instead of `feat:` when the change restores intended behavior without
adding new behavior.

Commit messages must use Conventional Commits. See
`docs/adr/0007-use-conventional-commits.md` for the project rule and examples.
If you want an interactive helper, Commitizen can guide the message format:

- [Commitizen CLI](https://github.com/commitizen/cz-cli)
- [Commitizen commit command docs](https://commitizen-tools.github.io/commitizen/commands/commit/)

### 6. Verify, Retrospective, and Archive

Run bridge verification after implementation:

```text
/opsx:verify <change-name>
/opsx:continue <change-name>
/opsx:archive <change-name>
```

After `/opsx:verify <change-name>`, run `/opsx:continue <change-name>` to start
the retrospective. The retrospective is collaborative: review it, add missing
risks, corrections, decisions, follow-up notes, or evidence, and ask Codex to
revise it before archiving.

Archive moves the change under `openspec/changes/archive/` and syncs accepted
requirements into `openspec/specs/`. Commit those artifacts:

```bash
git add -A
git commit -m "docs: archive <change-name>"
```

Run final verification before merging:

```bash
npm run openspec:validate
npm run doctor
```

Run `npm run supabase:reset` again if the change touched migrations or seed data.

### 7. Merge Back to Main

Bring the branch up to date with trunk before merging:

```bash
git fetch origin
git switch main
git pull --ff-only
git switch <change-branch>
git rebase main
```

Resolve conflicts in the worktree, rerun final validation, then merge:

```bash
git switch main
git merge --ff-only <change-branch>
```

If a fast-forward merge is not possible, stop and decide whether to rebase again
or open a pull request for review. After merge, remove the worktree only after
the branch is safely merged and no uncommitted work remains.

### Optional: Use Git Town

Git Town can save time on branch sync, shipping, and cleanup. It is optional for
this repo, but recommended if you do frequent trunk-based work.

Install:

```bash
brew install git-town
```

Useful commands:

```bash
git town sync       # update the current branch and its ancestors
git town propose    # open or update a pull request when configured
git town ship       # merge a completed branch and clean it up
```

Use Git Town only after you understand what it will do to the branch. For
OpenSpec bridge changes, do not `ship` until verify, retrospective, archive, and
final validation are complete.

## Seed Data Rules

Follow `AGENTS.md` for stable ID, conflict-free seed data, and post-seed
integrity requirements while `supabase/seed.sql` exists. In short: use checked-in
stable IDs, let duplicates fail loudly, and add assertions for expected rows and
relationships.

`supabase/seed.sql` is not the target data-loading model. New intake behavior
should move the project toward archive- and mapping-ledger-driven `intake file`
and `intake reset` instead of expanding seed-based loading.
