# sources Blueprint

## System Overview

`sources/` holds one folder per intake source. A source's folder path is its
source namespace, written as a reversed domain: `sources/gov/texas/tcole` is the
source `gov/texas/tcole`. A folder is a source when it holds an
`intake.source.ts` file that exports a `source` object of type
`IntakeSource` ([src/cli/intake-source.ts](../src/cli/intake-source.ts)). The
CLI finds sources by walking this tree
([src/cli/source-discovery.ts](../src/cli/source-discovery.ts)).

A source declares any of four phases: `acquire` (save raw source files),
`transform` (return artifacts of the kinds listed in `produces`), `request` (a
public-records request definition) and `daily`. `IntakeSource` also has the
optional fields `description`, `standalone` and `portalForm` (a portal form for
the request). The folders between `sources/` and a source hold no code; each has a README that only links to its children.
`lib/` is not a source: it holds code that sources share.

## Subdirectories & System Boundaries

- com: [./com/README.md](./com/README.md) - Sources `com/courtlistener/www/api`
  (civil cases), `com/serpapi/landing-page-search` (daily news search and
  publication), `com/site/my/mnitservices/post-license-search` (Minnesota POST)
  and `com/youtube/policeactivity` (channel videos linked to named officers).
- gov: [./gov/README.md](./gov/README.md) - Ten sources.
  `gov/census/www2/gazetteer` and `gov/irvingtx/arrests` acquire and transform;
  `gov/texas/tcole` transforms only; `gov/az/post/roster` is disabled; the other
  six hold a public-records request definition and no acquire or transform.
  One of the six, `gov/sc/sccja`, also declares a `portalForm`.
- lib: [./lib/README.md](./lib/README.md) - Code shared by sources: civil-case
  IDs and court tokens, person-name tests, news article extraction, matching and
  merging, the news inference client, domain-rank lookup, personnel name
  variants and a YouTube Data API client.
- net: [./net/README.md](./net/README.md) - Sources
  `net/bpl-orsnapshot/www/public-inquiry-cj` (Oregon DPSST roster) and
  `net/clearinghouse/api` (Civil Rights Litigation Clearinghouse civil cases).
- org: [./org/README.md](./org/README.md) - Sources `org/policeconduct/manual`
  and `org/policeconduct/submissions` (both `standalone`),
  `org/psvproject/arrest-tracker` and
  `org/wikipedia/en/us-federal-law-enforcement-agencies`.
- us: [./us/README.md](./us/README.md) - Source `us/fl/state/fdle/cjstc`, a
  public-records request definition for Florida.

## Global Invariants

- `src/cli/source-discovery.ts:discoverSources` treats a folder as a source only
  when it holds a file named `intake.source.ts`; the source ID is the folder's
  path under the root (`src/cli/source-namespace.ts:sourceNamespace`). It visits
  every folder under the root, including `lib/` and the folders below a folder
  that is a source, and returns the sources sorted by ID.
- `src/cli/source-namespace.ts:sourceNamespace` throws
  `Invalid source directory outside the sources root: <dir>` when the folder is
  the root itself or is not under it.
- `src/cli/source-discovery.ts:loadIntakeSource` and
  `src/cli/source-namespace.ts:sourceNamespace` both call
  `src/shared/source-namespace.ts:assertValidSourceId`, which throws
  `Invalid source id: <id>` unless every `/`-separated segment starts with
  `[a-z0-9]` and holds only `[a-z0-9._-]`.
- `src/cli/source-discovery.ts:loadIntakeSource` throws:
  - `Unknown source id: missing intake.source.ts at <file>` unless the marker
    is a regular file. A missing marker, a symbolic link and a directory all
    throw.
  - `Source <id>: intake.source.ts must export a source object.` when the
    module's `source` export is missing, is not an object, or is an array.
  - `Source <id>: <phase> must be a function.` when `acquire`, `transform` or
    `daily` is present and is not a function.
  - `Source <id>: transform and produces must be declared together.` when a
    source declares one without the other.
  - `Source <id> must declare a produces array` when `produces` is not an
    array, and `Source <id> produces an unknown kind: <kind>` when an entry is
    not an import artifact kind.
  - `Source <id>: request is malformed at <path>.` when `request` does not
    pass `src/cli/requests/lifecycle.ts:requestDefinitionSchema`.
- `src/cli/source-discovery.ts:loadIntakeSource` does not check
  `description`, `standalone` or `portalForm`; it casts the object to
  `IntakeSource`.
- `src/cli/intake-source.ts:IntakeSource` allows `transform` and `produces` only
  together: a source declares both or neither.

## Global Side Effects

- Acquire phases save raw source data. Most make network calls to the source's
  site and write raw files to the source directory and state they are given;
  each source's README lists its own calls and files. The exceptions:
  - `org/policeconduct/manual` makes no network call. It reads the record from
    the environment or from stdin and writes to state.
  - `org/policeconduct/submissions` runs the `aws` command, which uploads to
    and downloads from S3, and writes to the folder named by
    `SUBMISSIONS_BUCKET_DIR`, not to the source directory.
  - `net/clearinghouse/api`, `com/youtube/policeactivity` and
    `com/courtlistener/www/api` also read agencies from the database through
    `data.agencies`.
- Transform phases read the acquired files and return artifacts. Several also
  resolve agencies and personnel through the data context they are given and
  write a report file to state.
- `com/serpapi/landing-page-search` is the only source with a `daily` phase; it
  reads and writes objects in S3 and publishes to the website release.

## System Verification

- Run:
  `npx vitest run test/sources`.
