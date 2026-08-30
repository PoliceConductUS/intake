# ADR 0032: Per-Officer Arrest Profiles

## Status

Accepted

> An intake source that turns an agency's arrest records into a per-officer
> analytic. Applies the same acquire/run split
> ([ADR 0005](0005-use-source-specific-artifact-producers.md)), resolve-or-fail
> ([ADR 0023](0023-contexts-return-mapped-source-ids-never-canonical-ids.md)), and
> everything-resolves-to-an-officer discipline every other source uses.

## Context

The user has records-request (FOIA) exports of Irving PD arrests. Two kinds exist,
and they identify the arresting officer differently:

- **`Arrest Data Since Jan-1-2020 redacted.xlsx`** (~41.7k arrests) — an
  `Arrest_Officer_Name` per arrest (`LAST,FIRST`), the date/time, district, the
  booking, and (in sibling sheets) the charges. No arrestee demographics; the
  booking name/address are arrestee PII.
- **`Police_Arrests_20250718.csv`** (~116k rows) — richer (race, sex, age, home
  ZIP, beat) but names officers only by an **internal employee number** that maps
  to neither the public badge nor anything in our roster.

Our roster (`agency_personnel`) stores officers by **name only** — Irving's 518
officers have no `badge_number`. So the redacted workbook resolves against the
roster (by name), while the rich CSV does not (its employee numbers have no key in
common with the roster). The goal is to surface each officer's arrest pattern —
counts by year, offense, district, time — in a section of the officer's page.

## Decision

Add source `gov.irvingtx.arrests` producing one new entity, **`ArrestProfile`**: a
per-officer summary keyed 1:1 to `agency_personnel`, with two JSONB columns
(`coverage`, `breakdowns`).

**1. Resolve the arresting officer by name, resolve-or-fail.** `acquire` reads the
redacted workbook; `run` resolves each `Arrest_Officer_Name` to an
`agency_personnel` at Irving PD via the existing name resolver
(`resolvePersonnel`, ADR 0023 — a mapped source id out, never a canonical id). A
name that does not match the roster is counted in a run-output `arrest-report.json`
and never published — only roster officers get a profile.

**2. Store computed breakdowns, not raw arrests; analysis is not a mutation.** The
profile's `breakdowns` is a flexible map of dimension → bucket → count
(`by_year`, `by_month`, `by_iso_week`, `by_day_of_week`, `by_hour`, `by_district`,
`by_offense`, `by_charge_level`). A dimension appears **only when the data supports
it** (an all-`unknown` dimension is omitted), so the same entity fits any agency's
export regardless of which fields it carries. `coverage` records the source,
agency, month range, and total. The page renders whatever breakdowns are present.
The primary charge per booking (from the workbook's `Charges` sheet) supplies
`by_offense`/`by_charge_level`.

**3. No arrestee PII persists** ([ADR 0029](0029-align-the-public-report-model-to-the-report-new-form.md) §3
applied to arrestees). This is an _officer_-accountability site. `acquire` derives
only the officer name (used transiently in run to resolve, never stored) and the
category buckets; the booking name and address are dropped in `acquire` and never
reach the scrubbed `arrests-normalized.jsonl` that `run` reads.

**4. The profile is recomputed, not immutable.** Identity is find-or-mint by the
unique `agency_personnel_id` business key
([ADR 0028](0028-natural-key-and-composed-identity.md) / business-key convergence),
with the default `update` upsert: a re-run replaces the officer's summary in place.
Unlike a report (immutable), an arrest profile is a derived rollup that refreshes as
the underlying export grows.

**5. acquire owns the read; ordering is FK-derived, not standalone.** The workbook
path is `IRVING_ARRESTS_FILE` (never committed — it carries PII); the parse/scrub
happens in `acquire`, so `transform` is deterministic. Name resolution needs the full
roster, so the source must run after `AgencyPersonnel` is applied — but that ordering
already falls out of the FK dependency (`ArrestProfile → agency_personnel`, ADR 0021),
so **no `standalone` flag is used**. `standalone` means "reads its records from state
and runs alone" (the manual-curation sources, ADR 0031); this source instead reads a
normal acquire-produced file from `paths`, and marking it standalone would starve it
of that input. It stays out of unattended rebuilds naturally: its input is a
local-only PII file, so a rebuild that has not acquired it simply skips it.

## Consequences

- New table `public.arrest_profile` (migration `20260904000000`), `ArrestProfile`
  entity descriptor, and the generated specs/mutations. JSONB columns map to
  `z.record(z.string(), z.unknown())` with no override.
- The breakdown dimensions live in the `DIMENSIONS` table in
  `sources/gov.irvingtx.arrests/arrest.ts`; adding one is a one-line change. A
  different agency's arrest export is onboarded by mapping its columns to the same
  normalized shape — the entity and run logic are agency-agnostic.
- End-to-end this produces 320 profiles from 41.7k arrests (320 of 518 roster
  officers matched by name; 275 arrest-data names unmatched — former officers, name
  variants, or assisting non-Irving officers — reported, not published).

## Deferred (phase 2)

- **Arrestee-neighborhood income.** The redacted workbook carries the arrestee's
  `Booking_Address`, so a `by_income_bracket` breakdown is derivable: geocode the
  address → census tract (the project's key-free Census geocoder), then the ACS
  median household income for that tract → bracket. The ACS value requires a free
  `CENSUS_API_KEY` (the `api.census.gov` data API rejects keyless requests), so this
  waits on that key. Only the bracket would persist — never the address.
- **Race / sex / age.** These exist only in the employee-number CSV. Bridging it to
  officers means aligning its employee numbers to known officers via the CAD/arrest
  records we already have (a partial map), with the remainder coming from a future
  personnel FOIA. Until then the demographic breakdowns are out of reach.

## Alternatives Considered

- **Resolve officers by badge/employee number.** The roster has no badge numbers and
  the rich CSV's employee numbers share no key with it, so number-based resolution
  resolves nothing today; name resolution against the name-only roster is the only
  path that works.
- **Store one raw `Arrest` row per arrest; compute breakdowns as a SQL projection.**
  More faithful and re-sliceable, but heavier for a page that renders a fixed set of
  per-officer charts. The computed profile is simpler; raw facts can be added later
  if ad-hoc slicing is needed.

## Revisit Trigger

A `CENSUS_API_KEY` is available (wire income); the employee-number CSV is bridged to
officers (adds demographics); a second agency's export is onboarded (confirm the
normalized shape generalizes); or ad-hoc slicing forces raw-arrest storage.
