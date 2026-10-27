# TX POST (TCOLE) Reconstruction — Design

**Status:** Approved decisions captured; ready for implementation planning.
**Branch:** `redesign-config-driven-intake` (all config-driven intake work consolidated here).
**Date:** 2026-08-12

## Goal

Add TX POST (TCOLE) as a config-driven intake source so intake reconstructs the
existing TX rows of the production database from external TCOLE files —
preserving existing canonical IDs — and, beyond seed, ingests the richer
license-action history. TX is ~86% of the DB's agencies, so this is the
highest-leverage step toward retiring `seed.sql`.

## Source data

A **single** TCOLE Public-Information-Act workbook:
`PublicInformationRequest_2025-02-10_1410.xlsx` (16.9 MB, produced 2025-02-10).
Sheets: `Departments` 3,906 (**with addresses**), `Officers` 129,973, `Services`
170,754, `OfficersLicensesActions` 189,629. This is the file `seed.sql` was built
from (via `data.policeconduct.org/TX/config.py`), and it carries everything the
full model needs — agencies, officers, assignments (with `APPOINTMENT`/`LICENSE`),
and the license-action history.

A second, earlier export (`…DepartmentData_02.04.25.xlsx`, produced 2025-02-04) was
evaluated but is an **interim TCOLE export with known problems** (per TCOLE
correspondence), so it is **excluded**; TX is a single import from the 02-10 file.
This drops the two-file merge, the ordered runs, and the 608-service edge case
entirely.

The file is read read-only from outside the repo (acquisition is a separate
concern — treated as an already-acquired input, like the gazetteer's cached TIGER files).

A second input, **checked into the source**, is the curated `licensing-authorities`
reference file (~55 US POST agencies; columns `key`, `name`, `abbreviation`,
`state`, `website`), normalized once from public directories (IADLEST, the Army
"States' POST" list, agency sites).

**Dependency:** the census-gazetteer location_paths must already be imported —
agencies resolve their location_path via geocoding, and each LicensingAuthority
resolves `location_path_id` to the gazetteer's `level: state` path (`/tx/`) using
the same cross-source location_path resolution.

## Architecture

A config-driven source (`sources/gov.tx.tcole/config.ts`, namespace
`gov.tx.tcole`) whose deterministic `run(deps)` returns a manifest of emitted
records. The existing `intake run` → `runImportArtifactsCommand` pipeline does
the rest. Nothing about acquisition, geocoding, or DB mutation is re-implemented.

### Field mappings (existing kinds)

**Agency** ← `Departments`, keyed `DEPARTMENT_NUMBER`:

- `name` ← `DEPARTMENT_NAME`; `state` ← `STATE`; `city` ← `CITY`
- `address` ← `ADD_LINE1` (+ `ADD_LINE2` when present); `zip_code` ← `ZIP_CODE`
- `contact_name` ← `HEAD_NAME`; `contact_email` ← `E_MAIL`
- `phones` ← `{ main: PHONE, fax: FAX }` (when present)
- **Not emitted:** `slug`, `location_path_id`, `latitude`, `longitude` — these
  are produced by the import pipeline's existing agency resolution (see below).

**Personnel** ← `Officers`, keyed `PUBLIC_GUID`:

- `first_name` ← `FNAME`; `last_name` ← `LNAME`; `middle_name` ← `MNAME`; `suffix` ← `SFX`

**AgencyPersonnel** ← `Services`, keyed by the synthetic tuple
`PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`
(dates `YYYY-MM-DD`, empty segment when null — must match the abandoned map's key format exactly):

- `agency_id` ← `DEPARTMENT_NUMBER` (**source key**, resolved to canonical via the ledger by `transform.ts`)
- `personnel_id` ← `PUBLIC_GUID` (**source key**, resolved via the ledger)
- `start_date` ← `ST_DATE` (`YYYY-MM-DD`); `end_date` ← `END_DATE` or null
- **`title`** ← `APPOINTMENT` (the role — "Peace Officer", "Chief of Police"); NOT
  NULL. (This is the corrected name for the mis-named `license_type` column.)
- **`license`** ← the source `LICENSE` — a reference resolved to the officer's
  License entity via the ledger (`PUBLIC_GUID|LICENSE`). This is the "held under a
  license" link.
- `APPOINTMENT` and `LICENSE` both remain in the AgencyPersonnel identity key.

Referential integrity: every `DEPARTMENT_NUMBER`/`PUBLIC_GUID` referenced by a
Service must have an emitted + ledger-mapped Agency/Personnel, or `transform.ts`
throws "references unmapped …". The config must guarantee this.

### Location resolution — REUSE existing infrastructure (no new code)

The import pipeline already: geocodes agency addresses via the **US Census
Geocoder** (`agency-coordinate-resolver.ts` → `geocoding.geo.census.gov`
addressbatch, batch 1000; wired **by default** at `config.ts:724`), resolves
address → `location_path_id` (`agency-address-resolution.ts`), and caches results
as `ResolvedProperty` records keyed by an `inputFingerprint`
(`agency-field-resolution.ts` / `agency-coordinate-cache.ts`). MN POST agencies
already flow through this. TX agencies inherit it automatically by emitting raw
address fields. Point-in-polygon runs against the ported gazetteer geometries;
geocoding stays a cached, replayable resolution step outside deterministic `run()`.

### ID stability — seed the ledger from the prior mapping

Existing canonical IDs must be preserved. The abandoned prior attempt
(`PoliceConductUS/abandoned/data-requests/identity/sources/tcole/*.yaml`) already
maps every TCOLE source key to its `seed.sql` canonical ID:

- `agencies.yaml`: `DEPARTMENT_NUMBER → agency.id`
- `personnel.yaml`: `PUBLIC_GUID → officers.id`
- `agency-officers.yaml`: synthetic tuple → `agency_officers.id`

A one-time **ledger-seed step** transcribes these into the intake
`SourceNameToCanonicalId` ledger for namespace `gov.tx.tcole` via the existing
`persistSourceNameToCanonicalIds` (DRY — no hand-rolled YAML; correct encoding).
Because the ledger key = emitted record key (`sourceNameForImportRecord` is
identity) and the reader keys off `metadata.name`, a pre-seeded mapping is
**reused** by `resolveArtifactsSourceNameToCanonicalIds`; only genuinely-new
entities get a fresh `cuid2`. Result: existing entities keep their seed IDs;
new/changed entities are additive.

Validation note: the source file is newer than seed, so row counts exceed seed
(more current data). Success = existing IDs preserved + no unexpected losses,
**not** exact row-count parity with seed.

## Corrected domain model (the "fix the model now" decision)

TCOLE is a _licensing_ authority: it issues a **License** of a type directly to a
**Personnel**, and separately records an **Assignment** of that person to an
employing **Agency**, held _under_ a license, with a **title** (role) that changes
over time. The current DB conflates this: `agency_officers.license_type` (renamed
from `title` by migration `20260626000000`) actually holds the **role**
(`APPOINTMENT`), and the real license + its status/actions were discarded by seed.
This change fixes the model.

```
LicensingAuthority ──issues──> License ──held_by──> Personnel
 (name, location_path=/tx/)       │                      │
                                  └─1:N─> LicenseAction   └─1:N─> Assignment ──N:1──> Agency
                                                                  (title, start/end,      (employer)
                                                                   under a License)
```

**Entities**

| Entity                                  | Meaning                                                      | Key fields                                                                               | Source                                                                       |
| --------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **LicensingAuthority** (new)            | the licensor (TCOLE); jurisdiction = a location_path subtree | `name`, `abbreviation`, `website`, `location_path_id` (`/tx/`)                           | curated reference file of ~55 US POST agencies (see below)                   |
| Personnel                               | the officer                                                  | name                                                                                     | `Officers`                                                                   |
| **License** (new)                       | a license held by a Personnel, issued by an authority        | `officer_id`, `license_type`, `status`, first-awarded date, **`issued_by_authority_id`** | distinct `PUBLIC_GUID`×`LICENSE` from `OfficersLicensesActions` + `Services` |
| **LicenseAction** (new)                 | an event on a license                                        | `license` ref, `action`, `action_date`, resulting status                                 | `OfficersLicensesActions` rows                                               |
| Agency                                  | the employer                                                 | name, address, …                                                                         | `Departments`                                                                |
| **Assignment** (AgencyPersonnel, fixed) | employment period                                            | `officer_id`, `agency_id`, **`title`**, `start_date`, `end_date`, **`license`** ref      | `Services`                                                                   |

**Licensing authorities are their own dataset.** Rather than each POST source
declaring its authority inline, a curated reference file of the ~55 US POST
agencies (50 states + DC + territories + DOD — normalized from public sources:
IADLEST, the Army "States' POST" directory, and each agency's site; columns
`key`, `name`, `abbreviation`, `state`, `website`) is checked into the source and
emitted as all LicensingAuthority records. The TCOLE source references the TX
authority by key. Every future state POST source (AZ/MN/CA…) reuses the same file.

**Linking — one FK, the rest by containment:**

- **→ state**: `licensing_authority.location_path_id` = the state path (`/tx/`,
  a `level: state` `location_path` row derived from the authority's `state`). The
  only stored geographic link.
- **→ county / place**: none stored. A county/place is under the authority iff its
  `location_path` descends from the authority's (walk `parent_location_path_id`).
- **→ agency**: none stored. An Agency links to its own (city) `location_path`; it
  falls under the authority via subtree containment, and the concrete relationship
  runs Authority → License (`issued_by`) → Personnel → Assignment → Agency.
- The authority for any officer/license is the one whose `location_path_id` is an
  ancestor of the entity's. For TX every license is `issued_by` TCOLE (`/tx/`).
  Jurisdiction generalizes to any level (a city licensor at `/tx/…/dallas/`); for
  POST it is always the state.

**Schema changes** (additive + one rename):

- new `licensing_authority` table (`name`, `location_path_id`);
- rename `agency_officers.license_type` → `title`; add `agency_officers.license_id` (FK, nullable);
- new `license` table (unique `(officer_id, license_type)`, `issued_by_authority_id` FK) and `license_action` table;
- refresh generated types. Existing `agency_officers`/`agency`/`officers` IDs are
  preserved (rename keeps rows; the value was always the title).

**Pipeline extension** — the registry gains **three** kinds (`LicensingAuthority`,
`License`, `LicenseAction`); `source-name-to-canonical-id/index.ts` gains their
entity blocks; `transform.ts` builds their rows and now also resolves the
Assignment's `license_id` via the License ledger and the License's
`issued_by_authority_id` via the LicensingAuthority ledger. LicensingAuthority /
License / LicenseAction rows are new to the DB → fresh `cuid2`; Assignment keeps
its seeded ID and gains `title` + `license_id`.

**Keys**

- LicensingAuthority: a stable source-declared key (e.g. `tcole`).
- License: `PUBLIC_GUID|LICENSE`.
- LicenseAction: `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE` (stable synthetic tuple).
- Assignment `license` ref: the source `PUBLIC_GUID|LICENSE`, resolved to the
  License canonical id via the ledger (throws if the license was not emitted).

## Single run

A **single** `intake run gov.tx.tcole` invocation reads the 02-10 workbook and
emits all six kinds from its four sheets:

- **LicensingAuthority** — TCOLE at `/tx/` (source-declared, one record).
- **Personnel** ← `Officers`.
- **Agency** ← `Departments` (addresses; pipeline geocodes → location_path).
- **License** ← distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`
  and `Services`, `issued_by` TCOLE.
- **LicenseAction** ← `OfficersLicensesActions` (189,629 rows).
- **Assignment** (AgencyPersonnel) ← `Services`, with `title`=`APPOINTMENT` and a
  `license` ref.

Emission order within the run respects dependencies (authority → license →
license-action; agency + personnel → assignment); the transform resolves all
cross-references (`agency_id`, `personnel_id`, `license`, `issued_by_authority_id`)
via the ledger. Because every referenced key is emitted in the same run, there is
no cross-run preservation concern.

Both phases run against the single 02-10 file; the split is by what reuses
existing machinery, not by input:

- **Phase A** (existing-DB reconstruction + rename): Agency + Personnel +
  Assignment (`title`) + the ledger-seed tool + the `license_type`→`title` rename
  migration, reusing the existing four kinds and the Census agency resolution.
  Reproduces the current DB (corrected column) with preserved IDs;
  `agency_officers.license_id` stays null until Phase B. Highest value, minimal
  pipeline surgery.
- **Phase B** (licensing model): new `licensing_authority`/`license`/
  `license_action` tables + three new kinds (LicensingAuthority, License,
  LicenseAction) + ledger entities + transform plumbing; emit them from the 02-10
  sheets (`OfficersLicensesActions` + `Services.LICENSE`); backfill
  `agency_officers.license_id` via the License ledger.

After Phase B, one `intake run gov.tx.tcole` emits all six kinds. Each phase gets
its own implementation plan.

## Non-goals / deferred

- Acquisition (how the xlsx file arrives) — separate system; the file is an input.
- **Generalize `agency_officers.badge_number`** to a typed agency-assigned
  identifier (value + type: badge / employee-id / serial / PID). It is the right
  place (on the assignment), but TCOLE carries no such value (stays null), so it is
  deferred until a source provides real data to design against.
- The **02-04 interim export** (excluded as a known-problematic TCOLE interim
  export) — revisit only if TCOLE issues a corrected full export.
- `data.policeconduct.org/TX/config.py` is a reference for how seed was built, not a porting target.
- Deleting `intake.census-gazetteer` / the abandoned data-requests tree (owner's call).

## Testing

- Source `run()`: deterministic + record-shape tests on small synthetic fixtures
  (mirroring `census-gazetteer/run.test.ts`), plus key-format tests asserting the
  AgencyPersonnel synthetic tuple exactly matches the abandoned map's `id_field`.
- Ledger-seed: round-trip test (YAML in → ledger files → `loadSourceNameToCanonicalIds` returns the same map).
- E2E: dry-run count reconciliation against the abandoned manifest (2,950 agencies mapped, 129,968 personnel, 143,694 agency-officers) + spot-check preserved IDs.
