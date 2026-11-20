# Design: keep state under one root and process every acquire in order

Related documents: [proposal](proposal.md), [tasks](tasks.md), [workspace state layout spec](specs/workspace-state-layout/spec.md), and the deltas for [agency-record-selection](specs/agency-record-selection/spec.md), [artifacts-database-import](specs/artifacts-database-import/spec.md), [current-summary-prompts](specs/current-summary-prompts/spec.md), [data-reset](specs/data-reset/spec.md), [intake-stage-completion](specs/intake-stage-completion/spec.md) and [workspace-source-inputs](specs/workspace-source-inputs/spec.md). This change depends on [`cache-call-results-and-files`](../cache-call-results-and-files/design.md); [`cache-every-acquire`](../cache-every-acquire/design.md) follows it.

The owner's rulings of 2026-11-17 and 2026-11-18 decide the layout and the acquire model; they were given in the owner's working sessions and are cited here by date. Where a decision rests on a ruling, the design also gives the technical reason.

## Context

**State roots today.** The code writes a source's own state to `state/<source id>/` (`src/cli/transform/state.ts`); the source-name mapping, `ResolvedProperty`, `PropertyCorrection` and the files of the cache that `cache-call-results-and-files` reworks to `state/intake/namespaces/<namespace>/`; and `RecordsRequest`, `InitialAgencyRoots` and records-request replies to `intake/state/` (`src/cli/requests/lifecycle.ts`, `src/shared/io/initial-agency-roots.ts`, `src/cli/requests/responses.ts`). AGENTS.md, ADR 0010 and the `artifacts-database-import` spec name `intake/state/namespaces/<namespace>/` for all of it, and ADR 0010 also names `intake/commands/`, which the code writes as `command/`.

**Acquires today.**

- `state/<namespace>/acquire.yaml` holds `latest` (the last successful acquire's output folder) and `resume` (written when an acquire starts, dropped when it completes). It has no `apiVersion` or `kind`; `readCommandPointer` and `writeCommandPointer` (`src/cli/state/command-pointer.ts`) read and write it. An acquire writes `latest` and then its completion marker, `command/<folder>/<namespace>/acquire-complete`.
- `retainedAcquiredInputs` (`src/cli/data/acquired-inputs.ts`) scans `command/` for completed outputs of the namespace, sorted by folder name (the time the acquire started). It throws when an output path is not `command/<time>-<id>/<namespace>/output`, when the folder does not hold exactly one `Command` envelope, when that envelope's namespace is another or its arguments are not `acquire <namespace>` or `data acquire <namespace>`, when `latest` is not among the outputs, and when there is none. It also returns completed outputs that sort after `latest`.
- `data transform` reads only `latest` (`sourceInputDir`, `src/cli/transform/index.ts`). `transform-completion.json` records the input folder (an absolute path) and its digest; the generate gate, `requireTransformCompletion` (`src/cli/state/transform-completion.ts`), requires that input to equal `latest`. `generateOneSource` (`src/cli/data/source-pipeline.ts`) calls the gate, and calls `runImportArtifactsCommand` (`src/cli/import/artifacts/index.ts`, not a CLI command), whose `readArtifactsStage` (`src/cli/import/artifacts/config.ts`) calls it again. `buildTransformSourceDeps` (`src/cli/transform/index.ts`) snapshots the transform's input through `snapshotInput`, which reads `latest`. `data reset`'s preparation skips a source whose `acquire.yaml` has no `latest`.
- `data reset` (`src/cli/data/reset.ts`) is the only command that processes every completed acquire. It first transforms each one to check it (preparation), then resets the database and, for each acquire in order, points `latest` at it and runs `data transform`, `data generate` and `data up` through `runIntake`, then puts `latest` back. `data update` (`src/cli/data/index.ts`) calls `transformOneSource` and `generateOneSource` directly for each source and applies, reading only `latest`.
- A chain entry is a `DatabaseMutations` or `IdentityRestoration` envelope in `data/mutations/`; its `data-mutation/version` and `data-mutation/previous` annotations link the chain (ADR 0033 §2). A large entry is written as chunk envelopes whose metadata is only `name` and `namespace`. The database's ledger `data_mutation_applied(version, previous_version, checksum, applied_at)` records each applied version and its file's checksum. The `data generate` and `data update` actions refuse to generate while any chain entry is unapplied (`assertAtHead`, `src/cli/data/chain.ts`). `data update` and `data transform` with no source record a failing source and go on to the next. Nothing records which acquire an entry came from.

## Goals / Non-Goals

**Goals**

- One state root, `state/`, with the three kinds of state folder the proposal names, and a workspace top level of `command/`, `state/` and `data/`.
- Any number of acquires per namespace, processed in the order the acquires ran.
- Which acquires a database holds is read from that database.
- Files placed by hand or downloaded outside an acquire follow the folder structure of an automated acquire.

**Non-Goals**

- Removing `resume` and `previousSourceDirs`: `cache-every-acquire` does that.
- A new cache: `cache-call-results-and-files` defines the only one.
- Checking the top of the workspace at run time (owner's ruling, 2026-11-18).
- Any Supabase migration, generated type or downstream app contract.

## Decisions

### 1. One root; a state folder per namespace

A command passed to a source gets that source's cross-command state folder, `state/<namespace>/`. A `namespaces/` folder under a state folder holds that parent namespace's state that must be separated by another namespace (owner's rulings, 2026-11-17 and 2026-11-18). So intake's state is `state/intake/`: what it keeps once, such as `ResolvedProperty`, is directly in it (`state/intake/<Kind>/`), and what it keeps per namespace, such as the source-name mapping, is in `state/intake/namespaces/<namespace>/<Kind>/` for every namespace, `intake` included. `InitialAgencyRoots` is intake's state about a source, so it is in `state/intake/namespaces/<namespace>/InitialAgencyRoots/`; only intake's import reads it, and a CLI command writes it when one is first needed (owner's ruling, 2026-11-18). Its only writer today, `intake workspace migrate-state`, is removed (decision 11), and the dev workspace holds none. This is the general rule; the namespace `intake` is no exception.

- Rejected: keeping `intake/state/` as a second root. Two roots are what the documents and the code disagree about today, and every new kind would have to pick one.
- Rejected: putting a source's own phase state under `state/intake/namespaces/`. The source writes and reads it, the code already keeps it in `state/<namespace>/`, and moving it would change every source's paths for no gain.

### 2. No run-time check of the old root; a test keeps it from coming back

No command checks the top of the workspace (owner's ruling, 2026-11-18), so no command looks for `intake/state/`. The one-time move fails when it would leave any file under `intake/state/`, and every workspace is moved before this change's code runs on it (Migration Plan). `test/architecture.test.ts` fails on any `.ts` file under `src/`, `sources/` or `scripts/` that names `intake/state` or passes the string `"intake"` directly followed by `"state"` to a path call, whatever the whitespace or line breaks between them, so no code writes the old root again. The test lands with the last change that removes such a path (`src/cli/requests/responses.ts`, Phase 4).

The old `ResolvedProperty` folder is inside `state/`, not at the top. `src/cli/state/resolved-property/index.ts` fails, naming it, when `state/intake/namespaces/intake/ResolvedProperty/` exists. A silent miss there would resolve slugs and coordinates again, and a changed slug is a defect (AGENTS.md, Stable IDs).

- Rejected: every command fails when `intake/state/` exists. It checks the top of the workspace, which the ruling rules out. Instead, the two readers whose old folder was under `intake/state/` fail, naming it, when it still exists: `loadInitialAgencyRoots` (`src/shared/io/initial-agency-roots.ts`) when `intake/state/namespaces/<namespace>/InitialAgencyRoots/` exists, and `RequestStore` (`src/cli/requests/lifecycle.ts`) when `intake/state/namespaces/<namespace>/RecordsRequest/` exists (owner's ruling, 2026-11-18). Those two old paths are the only ones the architecture test allows. Without them a workspace that was not moved would read as having no initial agency roots and no records requests.
- Rejected: one module that builds every state path. State paths are built in about fourteen places; the test guards the rule without moving them.

### 3. Source IDs that would break the layout are rejected

`sourceNamespacePattern` (`src/shared/source-namespace.ts`), which `assertValidSourceId`, `RecordsRequest` IO, command folders and the identity restore all use, rejects a value with a segment named `namespaces` (it would put a `namespaces` folder directly under `state/` or below another one) and a value of more than one segment whose first segment is `intake` (its state would land in intake's own folders). The namespace `intake` itself stays valid: `data reset` and other commands create command folders under it, intake's own source-name mappings use it, and the identity restore, which tests one folder name at a time, still walks `state/intake/namespaces/intake/`.

- Rejected: a check of each state path when it is built. Every such path starts from a source ID, so checking the ID covers them all in one place.

### 4. `acquire.yaml` lists the acquires; it is the only list

`acquire.yaml` keeps its place and its non-envelope form (owner's ruling, 2026-11-18):

```yaml
acquires:
  - command/2026-10-26T04-25-42-484Z-icypgxzfk0lnu02mla8qul7t/gov/irvingtx/arrests/output
resume: command/<folder>/<namespace>/output # only while an acquire runs or after one fails, as today
active: command/<folder>/<namespace>/output # only for a manual-only source, its acquire waiting for files (decision 9)
```

- Each entry is an acquire's output folder relative to the workspace. Entries are in command-folder-name order, which is the time each acquire started (owner's ruling, 2026-11-17): an entry for an acquire that started earlier than the last listed one is inserted in its place, and if the database already holds a later acquire, the next command fails, naming both (decision 6).
- Every source's acquires are listed: by its acquire module, by `--from-local`, or by the folder `data acquire` makes for a manual-only source (decision 9), standalone sources included. A standalone source (`standalone: true` in its `intake.source.ts`) reads no acquire in its phases, so its list is never taken as input.
- An acquire is complete only when its entry is in the list: the entry is its completion record, written as the acquire's last step (owner's ruling, 2026-11-18). The separate `acquire-complete` marker is no longer written or read, and `src/cli/acquire/acquisition-completion.ts` is removed; markers already in command folders stay, unread. If the list write fails, the acquire command fails and the acquire is not complete.
- Two acquires of one namespace at once are left as today, with no lock (owner's ruling, 2026-11-18).
- `readCommandPointer` fails, naming the file, on `latest` or any key other than `acquires`, `resume` and `active`.
- `retainedAcquiredInputs` reads the list and no longer scans `command/`. For each entry it checks what it checks today: the path is `command/<time>-<id>/<namespace>/output`, the folder holds one `Command` envelope whose namespace is the namespace and whose arguments are `acquire <namespace>` or `data acquire <namespace>`. It throws on any failed check. An entry whose output folder was removed while its command folder was kept (the accepted `data-reset` spec allows this) is skipped and logged, and is never pending; the last entry's output must exist.
- `sourceHasAcquiredInput` (`src/cli/data/source-pipeline.ts`) returns whether the list has an entry; it does not throw on an empty or absent list, so `data transform` with no source still skips a source never acquired.
- Rejected: no list, only the folder scan. The owner ruled that `acquire.yaml` is the list (2026-11-18). The list is also what a person or another tool reads to see what was acquired, without repeating the scan's checks.
- Rejected: the list and the scan both as sources. Two sources for one order can disagree, and the code would need a rule for which wins.

### 5. A command is told which acquires to take as input

The input of `data transform` and `data generate` is a list of acquires, oldest first, each an output path relative to the workspace, as in `acquire.yaml`. Only `data update` writes to the database; `data transform` and `data generate` never do, and `data reset` writes only through the `data update` it runs (owner's ruling, 2026-11-18, "Acquire replay corrections"). The list travels as follows:

- `transformOneSource` and `generateOneSource` (`src/cli/data/source-pipeline.ts`) take it in an options object, `{ acquires }`, beside their current parameters. `sourceInputDir` and `buildTransformSourceDeps` (`src/cli/transform/index.ts`) take it in place of reading `latest`.
- A command run through `runIntake` (as `data reset` runs each command) receives it in a new run-context field, `acquires`, on `IntakeCliDependencies` (`src/cli/run-intake.ts`) and `CliCommandDependencies` (`src/shared/cli/types.ts`), beside `useInitialAgencyRoots` and `keepCachedCallResults`. The `data transform` and `data generate` actions pass it on.
- A command given no list takes the pending acquires (decision 6).
- `transform-completion.json` records `input: [{ commandId, path, digest }, ...]` for the acquires the transform read, in place of the one absolute folder. A standalone source has no acquire; its record keeps `input: null`, as today. A record of the old shape fails to parse, and the gate reports, as today, that there is no recorded successful transform and names `data transform <source>`.
- The gate in `requireTransformCompletion` requires the recorded acquires to be the ones the generate takes as input, each listed and with its digest unchanged. It returns `{ artifactsPath, acquires }`. Both callers pass the list: `generateOneSource`, and `readArtifactsStage` (`src/cli/import/artifacts/config.ts`) through a new `acquires` option of `runImportArtifactsCommand` (`src/cli/import/artifacts/index.ts`). A `data generate` whose recorded transform read other acquires fails and names `data transform <source>`, as the gate does today for a changed input.
- `toDatabaseMutations` (`src/cli/import/artifacts/config.ts`, `DatabaseMutationsMetadataInput` in `src/cli/import/artifacts/data-context.ts`) writes those acquires into the envelope's `acquires` (decision 7).
- After the schema reset, `data reset` rebuilds by running `data update`, in which every listed acquire is pending; it writes to the database only through that `data update`. Each command it runs is its own command with its own folder and log (owner's ruling, 2026-11-18).
- `data reset` no longer writes `acquire.yaml` to steer a command; an acquire it runs (without `--no-acquire`) adds its entry as any acquire does. Its preparation gives each `data transform` it runs every listed acquire of the source, and skips a source whose list is empty, where it skipped one with no `latest`.

- Rejected: rewriting a pointer in `acquire.yaml` before each command, as reset does today. `latest` is removed, and steering a command by writing state leaves the state wrong when the command fails.
- Rejected: a user-facing `--acquire` option. Its only callers would be intake's own commands, which already pass a run context.

### 6. A command run alone takes every pending acquire as input

"Run alone" means given no list of acquires: by a person, by `data transform` with no source, or by `data update`. For a source that is not standalone (owner's ruling, 2026-11-18, "Acquire replay corrections"):

- The pending acquires are the listed acquires after the newest listed acquire that the targeted database (the one `DATABASE_URL` names) holds (decision 8), oldest first. With none held, every listed acquire is pending.
- A listed acquire that the database does not hold, while a later listed acquire of the same namespace is in it, is a bug: the command fails, naming both. Acquires are processed in the order they ran.
- `data transform <namespace>` transforms the pending acquires, oldest first, into one `Artifacts` (decision 7a). When none is pending it transforms the list's last entry, as it transforms `latest` today.
- `data generate <namespace>` generates from the recorded transform, which must be of the pending acquires (decision 5). Its mutation lists those acquires.
- `data update` does both for each source in dependency order and applies the mutation, as today. It is the only one of these commands that writes to the database.
- `data transform` with no source, and `data update`, skip and log a source whose list is empty, and otherwise keep today's handling of a failing source.
- To find the pending acquires, a command reads the database's ledger, so `data transform` and `data generate` of a source that is not standalone need `DATABASE_URL`, for reading only. Without it the command fails, naming the variable, before it starts its work: it writes no state, `transform-completion.json` included, and leaves no command folder (owner's ruling, 2026-11-18).
- `data update` decides `useInitialAgencyRoots` once at its start and passes it to every source (accepted `agency-record-selection` spec), as today.

- Rejected: transforming, generating and applying each pending acquire alone, as `data reset` does today. It makes `data transform` and `data generate` write to the database; the owner ruled that they never do.
- Rejected: taking only the oldest pending acquire per run. A person who runs `data transform` would process an acquire older than the one just acquired, and need as many runs as there are pending acquires.

### 7. A mutation records the acquires it came from

The metadata of a top-level `DatabaseMutations` envelope (`src/cli/import/artifacts/io/DatabaseMutations.ts`, and its mirror in `DatabaseMutationsDebug.ts`) gains `acquires`, a list of `{ commandId, namespace, path, digest }`, one for each acquire the transform read, oldest first. An acquire is identified by `commandId`, the command ID of the command that produced it (the name of its command folder's `Command` envelope); `namespace`, `path` (the output folder relative to the workspace) and `digest` (`directoryDigest` of that folder, from the transform's completion record) are evidence only (owner's ruling, 2026-11-18). The list is empty for a standalone source. A chunk envelope carries no `acquires`; its top-level envelope does. `acquires` is required on every top-level envelope; there is no compatibility path, and `data reset --no-acquire` runs right after this change's code (Migration Plan, step 3a). `data-mutation/previous` already names the entry before it; nothing else is added for it.

- Rejected: a ledger column. It needs a Supabase migration, and the chain file already carries the generate's provenance (`sourceArtifactsDigest`).
- Rejected: `transform-completion.json` as the record. It is workspace state, overwritten by each transform, so it cannot say what one database holds; the owner ruled that the targeted database decides (2026-11-18).

### 7a. Several acquires combine in the transform

A transform given several acquires runs the source's transform once for each, oldest first, and intake merges their `Artifacts` by record (kind and source name): a record that a later acquire also holds takes the later acquire's values; a record that only an earlier acquire holds is kept as that acquire has it (owner's ruling, 2026-11-18). This gives what processing the acquires one at a time through the database gives today, without writing to the database, and no source's transform changes.

- Rejected: giving the source's transform every acquire's files at once. Each source would have to handle records repeated across acquires itself.

### 8. Which acquires a database holds

An acquire is in a database when a row of its `data_mutation_applied` ledger (`readAppliedDataMutationChecksums`, `src/cli/database/data-mutation-ledger.ts`) names a chain file whose `acquires` lists the acquire's command ID. Each row's file in `data/mutations/` must match the row's checksum. A row whose file is missing or differs fails the command, naming the version, as `data verify` reports drift (`verify`, `src/cli/data/chain.ts`). `IdentityRestoration` entries list no acquire. A generate that writes no mutation records no acquire, so its acquires stay pending; an acquire listed in an applied mutation counts as held whether or not it changed anything.

- Rejected: trusting the chain files without the ledger. The chain in a workspace can be ahead of the database (generated, not applied) or belong to another database; only the ledger says what this database applied.
- Rejected: treating a row whose file is missing or changed as listing nothing. Its acquires would be taken as input again for a database that already holds them, without a word.

### 9. Manual-only sources, and Irving

A source whose files are placed by hand declares `manual: true` in its `intake.source.ts` (a new field of `SourceOperations`, `src/cli/intake-source.ts`). Irving declares it, and so do the ten sources that export no `acquire` and get their files only through `--from-local` today (`com/serpapi/landing-page-search`, `gov/arkansas/dps/clest`, `gov/az/post/roster`, `gov/delaware/post`, `gov/ms/dps/bleost`, `gov/sc/sccja`, `gov/texas/tcole`, `gov/wisdoj/lesb`, `gov/wv/das/leps`, `us/fl/state/fdle/cjstc`). A manual-only source may still export `acquire`, which works on the files once they are in its folder (Irving's geocodes and normalizes its workbook).

A manual-only source has at most one active acquire: a command folder made for files not yet placed, named by `active` in its `acquire.yaml`. It is not listed, because it is not complete. `data acquire <source>` of a manual-only source, without `--from-local` (owner's rulings, 2026-11-18):

- With no active acquire, it creates a new acquire command folder and names its output folder in `active`.
- With an active acquire whose folder is still empty, it keeps that one; no new folder is made.
- With an active acquire whose folder holds files, it completes that acquire: it runs the source's `acquire` on the folder when the source exports one, adds the folder to the list, and then creates a new empty active acquire.
- Each time it prints the active folder's path and tells the person to put the files there.

`data transform` and `data reset` skip an active acquire's folder: they log its path and count it as waiting for files, and it stays as it is (owner's ruling, 2026-11-18). It is not pending, because it is not listed; it is taken as input once the next `data acquire` completes it.

`--from-local` stays, beside this. `acquireFromLocal` (`src/cli/acquire/acquire-from-local.ts`) copies the files a person names into a new command's output folder and runs the source's `acquire` when it exports one; it serves any source, not only manual-only ones, and the accepted `intake-stage-completion` requirement "Local inputs do not bypass acquisition" relies on it for sources that also download. It is the one-step form when the files are already at hand. For a manual-only source with an active acquire whose folder is empty, it copies the files into that folder and completes that acquire instead of making a new one, so an empty active acquire never sits behind a later completed acquire.

The Irving acquire reads `arrests.xlsx` and `geography/` from its own output folder, not from `gov/irvingtx/arrests/source/`, and no longer copies them into `evidence/` (no code reads that folder). Its other outputs, which the transform reads, do not change.

- Rejected: keeping a fixed input folder and copying it into the command folder on each acquire. It keeps one set of files at a time outside any command, which the owner ruled out (2026-11-18: manual acquires follow the folder structure of automated ones).
- Rejected: replacing `--from-local` with the folder flow. Sources that also download use `--from-local` for locally staged inputs, and a person who has the files would need two commands instead of one.

### 10. Records requests

`RecordsRequest` moves to `state/intake/namespaces/<namespace>/RecordsRequest/` (`src/cli/requests/lifecycle.ts`).

The folder contract (owner's ruling, 2026-11-18): an agency may answer a records request by email with attachments. A records request whose answer is files has an acquire folder of its source, made as `data acquire` makes one for a manual-only source (decision 9), and the request is unfulfilled while that folder is empty. The sync, when it is built to this contract, finds the unfulfilled requests and saves each attachment of an answer into that request's acquire folder. Building it is outside this change.

Today's `requests sync` (`syncMessages`, `src/cli/requests/responses.ts`) saves every reply it receives under `intake/state/records-request-inbox/<message id>/`. This change only moves that path to `state/intake/records-request-inbox/`, so no code writes the old root; the change that builds the sync to the contract replaces it. No workspace under `~/dev/PoliceConductUS/intake-workspace/` has `intake/state/records-request-inbox/` (checked 2026-11-18), so no saved reply has to move.

### 10a. Accepted spec corrections the layout needs

- `npm run publish:import-schemas` (`scripts/publish-import-schemas.ts`) and its `$INTAKE_WORKSPACE/intake/schemas/` output are removed as dead code: nothing reads them, and the database is the single source of intake's models (owner's ruling, 2026-11-18). The accepted "Import Type Registry" loses its "Import schemas can be published" scenario. `type-annotation-envelopes` publishes its own contract when it lands.
- The accepted "Shared Update State" and "Shared Update State Shape" describe `shared-mutations` folders that no code has and `test/architecture.test.ts` forbids. They are rewritten as "Resolved Property State" and "Resolved Property Shape", which state what the code does: a resolved value is a `ResolvedProperty` in `state/intake/ResolvedProperty/` (owner's ruling, 2026-11-18). OpenSpec refuses a MODIFIED requirement that drops a scenario, so each is a REMOVED requirement with an ADDED one in its place.

### 11. `intake workspace migrate-state` is removed

The command (`src/cli/workspace/migrate-state.ts`) copies state into a separate workspace, reads `intake/state/namespaces/`, reads and writes `latest`, writes a top-level `backups/` folder and throws on a file of the cache. Nothing uses it, and the one-time move does not (owner's ruling, 2026-11-17: no migration code in intake). It is dead once this change lands, so it is removed with its tests, its README and both places `src/cli/README.md` names it (the command table and the folder list) (owner's ruling: dead code is removed as soon as it is found).

- Rejected: updating it to the new layout. It would be maintained code with no user.

### 12. The one-time move

A script outside the repository, run on a clone, as the owner ruled (2026-11-17: no migration code in intake; workspace moves are one-time scripts). It writes no cache entry. It writes any envelope through intake's canonical IO, imported from this change's commit, and builds each namespace's list with `retainedAcquiredInputs` imported from the commit before this change's code (today's scan). It:

- moves each file under `intake/state/` to its new place: `namespaces/<namespace>/RecordsRequest/` to `state/intake/namespaces/<namespace>/RecordsRequest/`, `namespaces/<namespace>/InitialAgencyRoots/` to `state/intake/namespaces/<namespace>/InitialAgencyRoots/`, and any other `namespaces/<namespace>/<Kind>/` (the source-name mapping) to `state/intake/namespaces/<namespace>/<Kind>/`, failing when a moved mapping maps a source key or canonical ID that `state/intake/namespaces/` already maps differently; it rewrites each path a `RecordsRequest` holds under the old folder (`evidence`, `responses[].evidence`, `responses[].attachments[].path`) to the new one, through `RecordsRequest` IO; it fails, naming the file, on anything else, and fails if any file would stay;
- moves `gov/` to `state/gov/` (owner's ruling, 2026-11-17). After this change no code reads `state/gov/irvingtx/arrests/source/`;
- moves each file in `state/intake/namespaces/intake/ResolvedProperty/` to `state/intake/ResolvedProperty/`;
- copies the bytes of each file in `media/` to `state/intake/namespaces/org/policeconduct/manual/BinaryFile/<sha256>.<extension>`, the folder where `cache-call-results-and-files` keeps a namespace's file bytes (owner's rulings, 2026-11-18 and 2026-11-19), with the extension from its name (`mp3`, `mp4`, `png`, `json`). It writes a `BinaryFile` record only for a file a manual record points at; in the dev workspace no record names any of the five, so it writes none, and the script's `README.md` lists each file with its old path and SHA-256. `provenance.json`'s bytes keep its record of the source URL;
- removes the `captions` key from each video in `state/com/youtube/policeactivity/video-cache.json`, and fails if any value is not `null`. Captions are never fetched (owner's ruling; `sources/com/youtube/policeactivity/README.md`), and no code reads the key, so it is dead data (owner's ruling: dead code is removed as soon as it is found);
- for each namespace that has an `acquire.yaml` or a completed acquire in `command/`, writes `acquires` from today's `retainedAcquiredInputs`, fails when the list's last entry is not `latest` (naming both; a dry run on the clone finds any such namespace before the move), and drops `latest`. When today's function throws "no completed acquisition", the list is empty and `resume`, if any, stays. An `acquire.yaml` that already holds `acquires` is left as it is. The script imports today's function from a separate worktree of the commit before this change's code, by absolute path;
- removes `assets/` once the photo's bytes are in the `BinaryFile` folder `cache-call-results-and-files`' move puts them in, with the same SHA-256, and fails otherwise; removes the emptied `media/`.

It leaves anything it has no rule for in place, fails before moving anything when a destination exists with different content, and changes nothing on a second run. Before it runs, it saves the `id` of every row, and the `slug` where the table has one, of every table in the `public` schema of the dev database except `data_mutation_applied`, to `ids-before.tsv` in its folder, for the check after the reset (tasks, Validate).

## Risks / Trade-offs

- [`data transform` and `data generate` of a source that is not standalone now read the database `DATABASE_URL` names, which the CLI loads from the env file] → They only read its ledger; `data update` remains the only one of them that writes, as today.
- [An acquire that completes after a later-started acquire is in the database, or one left out of the database while a later one is in it, would put older data over newer] → The command fails, naming both (decision 6).
- [Chain entries written before this change list no acquires] → `acquires` is required, and `data reset --no-acquire` runs right after this change's code (Migration Plan, step 3a), so every entry lists its acquires.
- [`cache-call-results-and-files` deletes command-folder files whose bytes it moved into `BinaryFile` folders after its reset, which changes the digests of recorded acquires] → An acquire is identified by its command ID; the digest is evidence only, so the deletion does not change which acquires a database holds.
- [A workspace that was not moved is read as if it had no state] → No command checks the top of the workspace (ruling). The readers of initial agency roots and records requests fail on their old folders (decision 2); every workspace is moved before this change's code runs on it, and the move fails if it leaves anything under `intake/state/`.
- [Two acquires of one namespace at once can lose a list entry or share a `resume` folder] → Left as today (owner's ruling, 2026-11-18).
- [Working out the pending acquires reads every applied chain file and checks its checksum, once per command] → The same read `data verify` does today, through `listEntries` and `verify` (`src/cli/data/chain.ts`), which the check reuses. No acquire folder is digested to find the pending ones.
- [Between the move and this change's code, the clone has a layout today's code cannot read] → No command runs on the clone between the two (Migration Plan).

## Migration Plan

The order, shared with `cache-call-results-and-files`' section 8:

1. `cache-call-results-and-files`' code, including its personnel photo task.
2. Its CourtListener and photo move, on a clone of the workspace.
3. This change's one-time move on the same clone, then this change's code; the script imports this change's IO, so both are written first. From then on only this change's code runs on that workspace, and no `data` command runs on it until step 3a.
   3a. `data reset --no-acquire` (owner's ruling, 2026-11-18), then the `id` and `slug` check (tasks, Validate).
4. The full CourtListener acquire.
5. `cache-call-results-and-files`' Minnesota task and move.
6. The reset; once it is verified, that change deletes its old files (Risks).
7. `cache-every-acquire`, which removes `resume` and `previousSourceDirs`.

The clone is made as in `~/dev/PoliceConductUS/intake-workspace/migration-2026-11-17/README.md`: check `lsof`, rename the workspace to a dated backup, `cp -c -R -p` it back (modification times kept), run the script twice (the second run changes nothing), and once on a fresh clone (the same output). The script's folder is `~/dev/PoliceConductUS/intake-workspace/migration-<date>-state-under-one-root/`. Rollback: the dated backup is the workspace as it was.

Other workspaces (checked 2026-11-18): `preview/` and `prod/` are empty. `dev-copy/` has `intake/state/namespaces/` with namespace names from before the 2026-11-17 migration (`gov.tx.tcole`, `landing-page-search`) and folders the script has no rule for (`audits/`, `backups/`, `gov.irvingtx.arrests/`, `reports/`); `clearinghouse-api/` has `commands/` and `state/`, also the layout before that migration; `ins81-fatal-force/` has `command/`, `data/` and `state/`. A workspace with the layout before 2026-11-17 goes through that migration first. Each is then moved the same way, after its folders are listed in the script's README, before this change's code runs on it.

## Open Questions

All open questions were answered by the owner on 2026-11-18 and are folded into the decisions above.
