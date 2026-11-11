# config-driven-source-import Specification

## Purpose

TBD - created by archiving change redesign-config-driven-intake. Update Purpose after archive.

## Requirements

### Requirement: Config-Driven Source Run Command

The intake CLI MUST provide `intake run <source-id> <path...> [--dry-run]` accepting one
or more file or folder paths. It loads `sources/<source-id>/config.ts`, invokes the
module's `run` with injected dependencies, receives the `Artifacts` manifest `run`
returns, and imports it through the existing artifacts import pipeline. The command MUST
NOT re-implement identity assignment, mutation planning, or database apply; it MUST
delegate those to the existing pipeline.

#### Scenario: Operator runs a configured source against a saved snapshot

- **WHEN** an operator runs `intake run gov.azpost.roster ./Officer-List.xlsx`
- **THEN** intake loads `sources/gov.azpost.roster/config.ts`, invokes its `run`, and
  hands the returned `Artifacts` manifest to the existing import pipeline, which assigns
  canonical ids and applies `DatabaseMutations`

#### Scenario: Multiple paths in one run

- **WHEN** an operator runs `intake run <source-id> file-a.xlsx file-b.xlsx`
- **THEN** intake passes both paths to `run`, and the records `run` returns from all paths
  are imported together

#### Scenario: Dry-run plans without applying

- **WHEN** an operator runs `intake run <source-id> <path> --dry-run`
- **THEN** intake writes the planned `DatabaseMutations` envelope to the run workspace and
  MUST NOT apply database mutations

#### Scenario: Command validates required arguments

- **WHEN** an operator runs `intake run` without a source id, or with a source id but no
  path
- **THEN** intake fails before invoking `run` or writing any database rows

#### Scenario: Unknown source id

- **WHEN** the `<source-id>` has no `sources/<source-id>/config.ts`
- **THEN** intake fails with a clear error before invoking `run` or writing any database
  rows

### Requirement: Source Module Contract

A source's config MUST be a `config.ts` module under `sources/<source-id>/` that exports
a deterministic `run` function. `run` MUST read the CLI-provided paths and **return** an
`Artifacts` manifest describing the records it generated; it MUST NOT emit through an
injected callback, perform the import, assign canonical ids, or write to the database.
`run` MUST be deterministic for its inputs: the same input bytes MUST produce the same
returned manifest, with no dependence on network access, wall-clock time, or randomness.
The module MUST also export a valid `produces` declaration as specified by derive-source-run-order. The runtime MUST fail before running when the module does not export `run` or a valid `produces` declaration.

#### Scenario: run returns a manifest the runtime imports

- **WHEN** a source's `run` reads its input and returns an `Artifacts` manifest of the
  records it generated
- **THEN** the runtime hands that returned manifest to the existing import pipeline

#### Scenario: Missing run export fails early

- **WHEN** `sources/<source-id>/config.ts` does not export `run`
- **THEN** intake fails before parsing any path or writing any database rows

#### Scenario: run is deterministic

- **WHEN** the same input paths are processed twice
- **THEN** `run` returns the identical manifest both times

#### Scenario: Missing produces fails early

- **WHEN** a source module omits its `produces` declaration
- **THEN** the runtime fails before invoking the source or writing database rows

### Requirement: Injected Source-Module Dependencies

The runtime MUST supply `run`'s dependencies by dependency injection — narrow,
explicitly-typed parameters wired by the `intake run` command acting as the composition
root, mirroring how `importArtifacts` receives injected adapters such as `logger` and
`clientFactory`. The runtime MUST NOT hand `run` a service-locator or broad context
object, and MUST NOT hand it any intake-owned database, canonical-id, mapping, or mutation
handle. The runtime MUST inject only the capabilities a module uses (for AZ POST, a
deterministic xlsx parse capability). When a module needs per-run evidence/output space or
reusable cache, the runtime MUST inject a per-run workspace path and a persistent state
path consistent with the current `Command` envelope's `path` and `statePath` grants. The
exact injected set is deferred design work; this requirement fixes the injection style,
not the full surface.

#### Scenario: run receives narrow injected dependencies

- **WHEN** the `intake run` command invokes a source module
- **THEN** `run` receives the CLI paths and the narrow capabilities it needs as explicit
  parameters, not a shared context object it reaches through

#### Scenario: Modules are not handed intake-owned state

- **WHEN** the runtime injects dependencies into `run`
- **THEN** `run` receives no direct database client, `SourceNameToCanonicalId` handle, or
  mutation-planning access; those remain owned by the runtime and the existing pipeline

#### Scenario: Injected parse capability is deterministic

- **WHEN** the injected xlsx parse capability reads the same workbook twice
- **THEN** it returns the identical rows both times, from the first sheet keyed by the
  header row

#### Scenario: Unreadable input fails before database writes

- **WHEN** a path passed to an injected parse capability is missing, unreadable, or not
  the expected format
- **THEN** intake fails before reading `SourceNameToCanonicalId` records or writing any
  database rows

### Requirement: Source-Local Identity In The Returned Manifest

Each record in the manifest `run` returns MUST be keyed by its source-local identity. The
runtime MUST preserve those keys when importing and MUST NOT generate canonical database
ids; canonical cuid2 assignment and persistence MUST remain the responsibility of the
existing pipeline's `SourceNameToCanonicalId` state.

#### Scenario: Record key is the source-local identity

- **WHEN** `run` returns a `Personnel` record keyed by `12345` for an officer whose POST
  ID is `12345`
- **THEN** the existing pipeline mints or reuses the canonical cuid2 for that source-local
  key, and the runtime assigns no canonical id itself

#### Scenario: The manifest carries no canonical ids

- **WHEN** `run` returns its `Artifacts` manifest
- **THEN** the manifest contains source-local record keys only and no canonical database
  ids

#### Scenario: Re-running the same snapshot is not a second import

- **WHEN** an operator runs the same source against a snapshot whose `Artifacts` identity
  already imported
- **THEN** the existing-import guard prevents a duplicate import rather than creating
  conflicting rows

### Requirement: Kind-Agnostic, Additive, Envelope-Validated Records

The runtime MUST import exactly the record kinds present in the returned manifest and MUST
NOT assume any particular kind is present. Records absent from a manifest MUST NOT produce
delete mutations. The runtime MUST NOT re-validate which target fields are legal; the
validity of each record MUST be enforced by the target kind's existing envelope schema,
failing loudly on an invalid record.

#### Scenario: Only returned kinds are imported

- **WHEN** a source's `run` returns only `Personnel` records
- **THEN** the import contains only `Personnel` records and no other kinds

#### Scenario: Disappearance does not delete

- **WHEN** a later snapshot's manifest no longer contains a record a prior manifest
  included
- **THEN** the runtime emits no delete mutation for the absent record

#### Scenario: Invalid record is rejected by the envelope

- **WHEN** a returned record omits a field the target kind's spec requires (e.g.
  `last_name`)
- **THEN** the existing envelope validation rejects the record and intake fails loudly
  rather than importing a partial row

### Requirement: Reuse of the Existing Import Pipeline and Change Record

The command MUST produce the durable record of what changed by reusing the existing
`DatabaseMutations` envelope written to the run workspace. This slice MUST NOT introduce a
new durable change-record type and MUST NOT emit any external change event.

#### Scenario: Import produces the existing durable artifacts

- **WHEN** a non-dry-run `intake run` completes successfully
- **THEN** a `DatabaseMutations` envelope is written to the run workspace by the existing
  pipeline and the database mutations are applied

#### Scenario: No new change type or transport is introduced

- **WHEN** `intake run` completes
- **THEN** intake writes no new change-record envelope kind and emits no external event or
  message

### Requirement: Reuse verified Census ZIPs

Census acquisition SHALL reuse matching selected ZIPs from the current output, previous completed acquisition, or interrupted acquisition. It SHALL compare the remote archive size and central-directory metadata, including entry CRCs, and verify local ZIP entry contents against those checksums before reuse. It SHALL download missing, changed, or damaged files and SHALL log reuse versus download. Historical inputs SHALL remain unchanged.

#### Scenario: Completed acquisition already has matching files

- **WHEN** an earlier completed acquisition contains a matching ZIP
- **THEN** the next acquisition checks it with a range request and copies it into the new output without downloading the full ZIP

#### Scenario: Changed or damaged file

- **WHEN** a file has changed remotely or its local contents fail ZIP integrity validation
- **THEN** acquisition downloads that file and replaces only the current output copy

#### Scenario: New required files

- **WHEN** the selected release adds COUSUB or CONCITY files absent locally
- **THEN** only missing or mismatching ZIPs require full downloads

#### Scenario: Interrupted acquisition from a different vintage

- **WHEN** a resumed output contains ZIPs outside the selected source set
- **THEN** the new output excludes those ZIPs while retaining the original interrupted acquisition

#### Scenario: Download failure

- **WHEN** a download fails or its body is shorter than the declared length
- **THEN** acquisition fails without publishing a partial replacement as a completed ZIP

#### Scenario: Source does not honor range requests

- **WHEN** the source returns the full file to a range request
- **THEN** acquisition uses that returned body without fetching it again

### Requirement: CLI authors source record exclusions

The CLI SHALL support `data exclude <source> <kind> <source-id> --reason <reason>` using the singular record kind and source-local identity. It SHALL append the entry to `$INTAKE_WORKSPACE/state/<source>/excluded.yaml` through shared exclusion IO, preserving existing entries and comments. The source must exist, the kind must be produced by that source, and the source ID and reason must be nonblank. An already excluded identity SHALL fail with its existing reason instead of overwriting it.

The command SHALL report the saved file and the transform and generate commands needed to use the exclusion. The existing transform exclusion cascade SHALL remove dependent records referencing an excluded record. Excluding an agency does not remove independent Personnel records. Raw inputs, previous artifacts, cache values, and existing database rows SHALL remain unchanged.

#### Scenario: Exclude the Alabama placeholder

- **WHEN** the operator excludes `gov.tx.tcole Agency 515001` with a reason
- **THEN** the source exclusion list contains that identity and reason
- **AND** the next transform excludes the agency and dependent assignments while retaining independent personnel
- **AND** the exclusion remains effective on subsequent transforms and resets

#### Scenario: Invalid or duplicate exclusion

- **WHEN** the source or kind is unknown, the source ID or reason is blank, or that identity is already excluded
- **THEN** the command fails and leaves the exclusion file unchanged

#### Scenario: Workspace-owned exclusions

- **WHEN** the operator excludes a record in a configured workspace
- **THEN** the CLI writes the source exclusion list in that workspace and transform reads that same list
- **AND** the source checkout is unchanged and repository exclusion files are not read
- **AND** switching workspaces uses the selected workspace's own exclusions
- **AND** existing entries, comments, and reasons are preserved when moving the current exclusion list into the workspace

Correction audit files and the manual-place audit list SHALL reside under the workspace `audits/` directory. Manual records themselves remain in the existing manual source state; relocating audit files SHALL NOT modify those records, cached corrections, or pending database mutations.

### Requirement: Applied exclusions are visible during transform

Transform SHALL log each explicitly excluded record present in its source manifest,
including source namespace, record kind, source ID, and recorded reason. It SHALL
also log counts removed by kind, including dependent records removed by the existing
cascade. Exclusion entries absent from the source manifest SHALL NOT be reported
as removed records.

#### Scenario: Explicit exclusion with a recorded reason

- **WHEN** transform removes a source record listed in workspace exclusions
- **THEN** its source identity and recorded reason appear in the command log
- **AND** removal counts by kind include dependent records
- **AND** transform with no removed records prints no removal summary

### Requirement: Manage manual resolved-property values through the CLI

The CLI SHALL provide `cache get` and `cache set` addressed by source namespace, entity kind, source ID, and property. Set SHALL accept declared properties through typed, source-addressed PropertyCorrection IO without requiring or minting a canonical identity, as specified by Conditional source-property corrections. Get SHALL inspect source corrections when present and existing canonical resolved entries when mapped. Set SHALL validate values against the canonical property schema, preserve replacement history, and record source and command provenance.

Manual cache corrections SHALL be made through `cache set`. Source transforms SHALL NOT populate the workspace cache from checked-in files. Clearing a cached property SHALL leave it absent until automatic resolution or an explicit CLI correction supplies it.

#### Scenario: A cleared cache stays empty during transform

- **WHEN** a source transform runs with an empty workspace cache
- **THEN** files in the source checkout do not populate the resolved-property cache
- **AND** generation resolves missing values normally or reports the required CLI correction

#### Scenario: Inspect an existing cache

- **WHEN** an operator runs `cache get` for an existing source identity
- **THEN** the command displays its source correction when present, otherwise its mapped canonical resolved-property entries

#### Scenario: Refuse an unforced overwrite

- **WHEN** an operator runs `cache set` and any cached value already exists
- **THEN** the command returns a nonzero status, displays existing values as JSON on a new line with two-space indentation, and leaves the cache unchanged

#### Scenario: Force a manual correction

- **WHEN** an operator supplies `--force`
- **THEN** set replaces the active source correction with the validated correction, retaining previous entries for audit
- **AND** application follows the conditional/default rules in Conditional source-property corrections rather than unconditional override precedence

#### Scenario: One entries collection for all cached values

- **WHEN** a ResolvedProperty is read or written
- **THEN** all values are stored in required `spec.entries`; `spec.override`, `spec.overrideHistory`, and top-level `spec.value` are rejected
- **AND** at most one entry has no `inputFingerprint`; that entry is the active override and takes precedence over fingerprinted entries without being rewritten on reads
- **AND** without an override, only the matching fingerprint is returned

#### Scenario: Replace an override

- **WHEN** a valid forced cache set replaces an existing override
- **THEN** the previous correction is retained as history and the new correction records its timestamp, source identity and canonical Command ID
- **AND** any mapped prior canonical manual override is retired so it cannot act as an unconditional fallback
- **AND** all automatic entries remain intact

#### Scenario: Convert existing cache state

- **WHEN** existing supported cache files are converted to the entries-only format
- **THEN** values, source evidence, metadata, and known original timestamps are retained
- **AND** unknown historical command IDs are not invented

#### Scenario: Coordinate failure offers map searches

- **WHEN** address geocoding returns no usable coordinates
- **THEN** the diagnostic includes a Google Maps search link for the entity name, followed by a Google Maps search link for its full address
- **AND** each search query is URL-encoded and the existing cache correction instructions remain available

#### Scenario: Invalid identity or value

- **WHEN** the kind, property, or value is invalid
- **THEN** the command fails without modifying cache state or assigning an identity

#### Scenario: Wrong value type

- **WHEN** an operator supplies a nonnumeric value such as `fred` for latitude or longitude
- **THEN** the command reports `Value must be a number.` and leaves the cache unchanged
- **AND** type errors name the expected type from the canonical property schema instead of listing unrelated JSON types

### Requirement: Load manual communities before agency resolution during reset

Reset SHALL apply manual LocationPath and LocationPathAlias records after Census locations and before dependent agency imports. The complete manual source SHALL still run after automatic sources to apply records that depend on agencies and personnel. The confirmed 29 missing Texas community records SHALL retain their published paths and original canonical IDs. No artificial boundaries or inferred agency assignments SHALL be created.

#### Scenario: An agency references a manually resolved community

- **WHEN** an agency's location cache explicitly names a manual community
- **THEN** that community exists before the agency's mutations are applied during reset

#### Scenario: A manual community has no boundary

- **WHEN** only a manual place record is present
- **THEN** address resolution does not invent containment; an explicit assignment is still required where Census resolution fails

### Requirement: Reset and regenerate the database from sources

`data reset` SHALL reset the database configured by `DATABASE_URL` to the repository's current schema migrations without legacy seed loading, retire the active mutation chain into the reset command's output, and generate and apply a new chain from sources. It SHALL preserve existing acquired inputs, source-name identity mappings, resolved-property state including canonical slugs, and durable manual records. It SHALL process automatic sources in dependency order and process the manual source last. Each source's generated changes SHALL be applied before processing the next source.

#### Scenario: Rebuild without acquisition

- **WHEN** the operator runs `data reset --no-acquire`
- **THEN** the command resets the database, retires the old chain, and runs transform, generate, and apply using existing inputs
- **AND** it does not invoke acquisition or replay retired mutations

#### Scenario: Default reset includes acquisition

- **WHEN** the operator runs `data reset`
- **THEN** each automatic source runs acquire, transform, generate, and apply in dependency order
- **AND** existing manual records are transformed, generated, and applied without prompting for new manual input

#### Scenario: Required location cannot be resolved

- **WHEN** source generation fails because a required location cannot be resolved
- **THEN** reset stops with a nonzero exit status identifying the failed source and phase and reports that the rebuild is incomplete
- **AND** it does not replace the failure with old generated data

#### Scenario: Schema reset fails

- **WHEN** resetting the configured database fails
- **THEN** the existing mutation chain remains in its original location and source processing does not begin

#### Scenario: Repeat a rebuild

- **WHEN** the operator repeats a reset with unchanged sources and retained identity state
- **THEN** the rebuilt rows retain their canonical IDs and slugs

### Requirement: Shared published Census vintage

Census acquisition SHALL select the newest Gazetteer vintage supported by the published TIGER shapefile release index. It SHALL follow the Gazetteer page's year links to obtain matching files and SHALL verify the selected year's required TIGER files against their directory listings before downloading ZIPs. It SHALL log the selected vintage and SHALL NOT mix years. Network failures and incomplete selected releases SHALL fail visibly rather than trigger an implicit retry with older data.

#### Scenario: Gazetteer is newer than TIGER shapefiles

- **WHEN** the Gazetteer page lists 2026 files and a 2025 page, while the TIGER index lists TIGER2025 but not TIGER2026
- **THEN** acquisition selects the linked 2025 Gazetteer page and matching 2025 TIGER files
- **AND** never requests a 2026 TIGER ZIP

#### Scenario: New shared release

- **WHEN** both publications list 2026
- **THEN** acquisition selects 2026 without a code change

#### Scenario: Missing publication or required files

- **WHEN** there is no shared published vintage, the year page returns another vintage, or a required TIGER file is absent
- **THEN** acquisition fails before downloading source ZIPs

#### Scenario: Fetch failure

- **WHEN** fetching a release page or listing fails
- **THEN** acquisition reports the failing URL and status without changing vintage
