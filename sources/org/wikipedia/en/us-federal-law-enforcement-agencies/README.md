# org/wikipedia/en/us-federal-law-enforcement-agencies

## Overview

Intake source for US federal law-enforcement agencies. Acquire saves the
Wikipedia list page and keeps two YAML lists of agencies in the source's state
folder: a candidates list rewritten on every acquire, and a curated list that
is created once and then left to the curator. Transform reads the curated
agencies and the curated `offices.yaml` from state (no code writes
`offices.yaml`; the curator creates it) and returns two artifacts:
kind `FederalAgencies` (one record per agency) and kind `Agencies` (one record
per office). An office that is incomplete or names an agency that is not in the
curated list stops the transform with an error.

## Interface

- `intake.source.ts:source` - the `IntakeSource` object:
  `{ description, produces: ["FederalAgencies", "Agencies"], acquire, transform }`.
- `acquire.ts:acquire` - `SourceAcquire`,
  `async ({ sourceDir, state, env, logger }) => Promise<void>`. Ensures the page
  HTML is in `sourceDir`, then maintains the agency YAML files in `state`.
- `acquire.ts:SOURCE_HTML_FILE` - `"federal-le.html"`, the saved page's file
  name in `sourceDir`.
- `transform.ts:transform` - `SourceTransform`, `async ({ state, logger })`.
  Returns
  `{ artifacts: [{ kind: "FederalAgencies", records }, { kind: "Agencies", records }], accounting }`.
- `model.ts:SOURCE_ID` - `"org/wikipedia/en/us-federal-law-enforcement-agencies"`,
  the prefix of every error this source throws.
- `model.ts:ORGS_FILE` - `"federal-agencies.yaml"`, the curated agency list.
- `model.ts:CANDIDATES_FILE` - `"federal-agencies.candidates.yaml"`, every
  agency parsed from the page.
- `model.ts:OFFICES_FILE` - `"offices.yaml"`, the curated offices.
- `model.ts:OrgsFileSchema` - strict zod schema `{ agencies: Org[] }` for
  `federal-agencies.yaml`.
- `model.ts:OfficesFileSchema` - strict zod schema `{ offices: Office[] }` for
  `offices.yaml`.
- `model.ts:Org` - type `{ slug: string; name: string }`.
- `model.ts:Office` - type
  `{ federal_agency, slug, name, state, city, address, zip_code }`, all strings.
- `model.ts:readCuratedFile` -
  `(stateDir, file, schema) => Promise<T | undefined>`. Reads and validates one
  curated YAML file; resolves to `undefined` when the file does not exist.
- Subdirectory: [acquire](./acquire/README.md) - parses the saved page into
  agency names (`acquire/parse.ts:parseFederalLeAgencies`, `acquire/parse.ts:slugify`).

`acquire.ts:DEFAULT_PAGE_URL` and `acquire.ts:maintainOrgs`, named below, are
not exported.

## Invariants

- `acquire.ts:acquire` downloads the page only when
  `<sourceDir>/federal-le.html` does not exist; an existing file is reused and
  no network call is made.
- `acquire.ts:acquire` throws `federal-le: failed to fetch <pageUrl>: <status>`
  when the response is not ok.
- `acquire.ts:acquire` uses `env.FEDERAL_LE_PAGE_URL` when it is defined,
  otherwise `acquire.ts:DEFAULT_PAGE_URL`. A value that is set and blank
  throws `<source>: FEDERAL_LE_PAGE_URL is set and blank` before any file or
  network access.
- `acquire.ts:maintainOrgs` rewrites `federal-agencies.candidates.yaml` on every
  acquire, and writes `federal-agencies.yaml` only when it does not exist. An
  existing `federal-agencies.yaml` is validated and never modified.
- `model.ts:readCuratedFile` resolves to `undefined` only for a missing file
  (`ENOENT`) and rethrows any other read error. The parsed YAML must match the
  strict schema: every field of an agency or office is a string that is not
  blank after trimming, and no other key is allowed. Otherwise it throws
  `<source>: <file> is not valid: <path>: <problem>`. An unquoted
  `zip_code: 20535` fails this way.
- `transform.ts:transform` treats a missing curated file as an empty list.
- `transform.ts:transform` throws
  `<source>: offices.yaml office <slug> names federal agency <agency>, which is not in federal-agencies.yaml`
  for an office whose `federal_agency` is not the slug of a listed agency.
- `transform.ts:transform` keys `FederalAgencies` records by `org.slug` and
  `Agencies` records by `office.slug`, and sets
  `parent_federal_agency_id` to `office.federal_agency`. A repeated slug throws
  `<source>: <file> repeats slug <slug>`.
- `transform.ts:transform` states its row accounting with one entry for
  `federal-agencies.yaml` and one for `offices.yaml`. Every agency and office
  read is emitted or the transform throws, so `reported` is 0 and
  `notSelected` is empty.
- `transform.ts:transform` always returns the two artifacts in the order
  `FederalAgencies`, `Agencies`, the same kinds `intake.source.ts:source`
  declares in `produces`.

## Side Effects

- `acquire.ts:acquire` - network: `fetch` of `env.FEDERAL_LE_PAGE_URL` or
  `acquire.ts:DEFAULT_PAGE_URL`
  (`https://en.wikipedia.org/wiki/List_of_United_States_federal_law_enforcement_agencies`),
  only when the saved page is absent.
- `acquire.ts:acquire` - files: creates `sourceDir`, writes and reads
  `<sourceDir>/federal-le.html`.
- `acquire.ts:maintainOrgs` - files: creates the state folder, writes
  `<state>/federal-agencies.candidates.yaml` on every acquire and
  `<state>/federal-agencies.yaml` when absent.
- `model.ts:readCuratedFile` - files: reads `<state>/federal-agencies.yaml`
  (acquire and transform) and `<state>/offices.yaml` (transform). Transform
  writes nothing.
- `acquire.ts:acquire`, `acquire.ts:maintainOrgs`, `transform.ts:transform` -
  logging through `logger.info`.

## Verification

- Run: `npx vitest run test/sources/org/wikipedia/en/us-federal-law-enforcement-agencies`
