# ADR 0003: Align Intake CLI and Code Organization

## Status

Proposed

## Context

The initial system is a CLI-driven process, not a long-running service. The
commands should match the domain and make the state transition clear.

CLI code should be organized around the same nouns operators use at the command
line and the same `kind` values used in YAML envelopes.

## Decision

Use this CLI vocabulary for local artifact import:

```bash
intake import artifacts [--dry-run] <artifacts-ref>
intake replay database-mutations <database-mutations-ref>
```

Command meanings:

- `import artifacts`: read and validate a source-produced `Artifacts` envelope,
  resolve intake-owned SourceNameToCanonicalId records, apply optional `ArtifactMutations` and
  `ArtifactMutation` envelopes, write an intake-owned `DatabaseMutations` or
  `DatabaseMutationsDebug` envelope, and apply the database mutations unless
  `--dry-run` is set.
- `replay database-mutations`: read and validate an intake-owned
  `DatabaseMutations` envelope and re-apply its ordered `spec.mutations` without
  reading SourceNameToCanonicalId records, source artifacts, or artifact mutations.

CLI routing code should mirror the command surface. The path after `intake`
becomes the directory path under `src/cli/`. Each command directory owns an
`index.ts` command handler, and subcommands are nested below it. The same
structure should be used under `test/` for command-facing tests:

- `src/cli/index.ts` is the CLI entry point.
- `src/cli/import/index.ts` handles the `intake import` command group.
- `src/cli/import/artifacts/index.ts` handles `intake import artifacts`.
- `src/cli/replay/index.ts` handles the `intake replay` command group.
- `src/cli/replay/database-mutations/index.ts` handles
  `intake replay database-mutations`.
- `test/import/artifacts.test.ts` covers `intake import artifacts`.
- `test/replay/database-mutations.test.ts` covers
  `intake replay database-mutations`.

This command-mirroring rule applies to command routing and command-facing
tests. It does not require envelope or database implementation modules to live
under `src/cli/`.

CLI parsing, argument validation, and help output must use Commander. Do not add
manual command-line parsers, hand-rolled help strings, or duplicated argument
rules. Command names, descriptions, arguments, and options should be declared on
the Commander command definitions and used as the source for help and parse
behavior. When possible, command definitions should delegate directly to the
typed command handler arguments so changing the command handler does not require
updating independent parser logic.

Every CLI `index.ts` must discover child command modules automatically from
command folders. Adding or changing a command or subcommand should not require a
matching import or registration edit in an ancestor `index.ts`; the command
folder's `index.ts` owns registration with its parent Commander command. Owned
source modules must follow the same command organization rule: their CLI
entrypoints use Commander, command folders own their `index.ts` registration,
and command modules are discovered automatically instead of being hand-wired in
a central parser.

Source modules may import shared intake support only from `src/shared/`.
`src/shared/cli/` is the supported surface for shared Commander registration
types and command discovery support. Root-only implementation code under
`src/cli/` are not a supported source-module import surface.

Implementation modules must have an explicit owner. Package by feature or
bounded domain first. Package by technical type only for deliberately shared
infrastructure with a clear contract, such as `src/shared/io/` or
`src/shared/cli/`. Do not create catch-all folders such as `src/import/`, and do
not add ambiguous `utils.ts`, `helpers.ts`, or similarly broad files. A folder
name must describe the bounded domain it owns, and files inside it must belong
to that domain.

Command-specific operations live under the command folder that owns them:

- `src/cli/import/artifacts/` owns `intake import artifacts` orchestration,
  artifact mutation application, source-name mapping resolution for that command,
  source record transformation, and import preparation context.
- `src/cli/replay/database-mutations/` owns `intake replay database-mutations`
  execution.

Cross-command root CLI services live under named `src/cli/` domain folders:

- `src/cli/database/` owns database access used by CLI commands.
- `src/cli/command-runtime.ts` owns root intake command folder creation.

Shared cross-module contracts live under `src/shared/`:

- `src/shared/io/` owns source-produced `Artifacts`, typed source artifact
  envelopes, `Command`, generated singular entity envelopes, generated plural
  collection envelopes, and generated database-derived spec schemas.
- `src/shared/cli/` owns shared Commander registration types and command
  discovery helpers.

Root-intake command and state envelopes such as `DatabaseMutations`,
`ArtifactMutations`, `ArtifactMutation`, and `SourceNameToCanonicalId` live
under the root command package that owns them. When those envelopes contain
database entity specs, they must reuse the generated database-derived spec
schemas from `src/shared/io/`.

Source modules must not import from root command implementation folders such as
`src/cli/import/`, `src/cli/replay/`, or `src/cli/database/`. Source modules may
import only from `src/shared/`.

Generated and hand-written envelope modules should use envelope kind names
directly. For example, kind-specific mutation envelopes sort by entity first and
action second, such as `AgencyCreate` and `AgencyUpdate`.

## Consequences

- The command surface is small and outcome-oriented.
- File and function names are discoverable from the CLI command and envelope
  kind.
- Envelope readers own validation; there is no standalone `validate` command.
- Replay is explicit, so re-applying an already prepared import cannot be
  confused with importing source artifacts.

## Alternatives Considered

- `consume`: rejected as too generic.
- `book`: rejected because it implies arrest/jail booking.
- `docket`: rejected as too court-specific.
- `register`: acceptable but less direct than `import`.

## Revisit Trigger

Revisit if the CLI becomes a service API and command names need to map to API
operation names.
