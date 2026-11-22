## Context

Website commit `84c5cec` removed every content and relationship decision from the website. The inventory `site-decisions-inventory.md` and the queue `intake-corrections-queue.md` list what the site used to compute. Two kinds of site logic remain on purpose:

- **Page-selection rules**, kept by the owner, to move into database views where possible.
- **Build projections**, written by the website script `scripts/refresh-build-projections.mjs` into `public.build_page_payload`, `public.agency_zip_index` and `public.location_path_closure`. The owner asked on 2026-11-22 to move these and every public count into the database.

The script today does this, in one transaction:

1. Selects agencies that have at least one current `agency_personnel` row (by the website predicate `currentAssignmentSql`: null `end_date`, null effective end date in `data_source_values`, start date not in the future) and whose place sits under an `administrative_area` row under a `state` row.
2. Counts, per agency: distinct current personnel, distinct reports through `review_personnel`, distinct civil cases through `civil_case_personnel`.
3. Groups agencies into states, areas and places. It derives the area kind and plural ("County", "Parishes") from name suffixes, prefers a non-all-caps city label, averages agency coordinates into place, area and state map points and pads bounding boxes.
4. Counts reports per location by exact `reviews.location_path_id` and civil cases per location by `path like prefix%` over agency locations.
5. Builds report rows, taking the report's agency from the first `review_personnel` row and state, area and place slugs by `split_part` of the path.
6. Rewrites `location_path_closure` for eligible locations, `agency_zip_index` from the first five ZIP characters (dropping `00000`), and `build_page_payload` as JSON per state, area, place, agency and report page, with a SHA-256 content hash.

Intake rules that apply: data enters the database only through envelopes and recorded mutations; `data up` never calculates; IDs come from the source-name mapping; manual records come from `org/policeconduct/manual` (ADR 0031); findings become annotations (ADR 0040); annotation messages move to a message table (ADR 0038).

## Goals / Non-Goals

**Goals:**

- Every fact the site shows is a stored column or a row filled by intake.
- Every page-selection rule, foreign-key chain and public count is one SQL definition in an intake migration.
- The website build only reads tables and views.
- Every text standardization is recorded as a correction annotation.

**Non-Goals:**

- Website code changes. They are listed under "Website follow-up" as a cross-repo note.
- Arrest data. The change `import-arrest-records` replaces `arrest_profile` and `agency_arrest_profile`.
- Records with a known agency and an unknown officer. The change `unknown-officer-records` covers them.
- Release news selection (preferred coverage copy, alias target) and roster provenance copy. See "Open Questions".

## Decisions

### D1. Fact columns

| Column                                      | Type and constraint                                                                                | Filled by                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agency_personnel.employment_status`        | `text not null`, `check in ('Current','Former','Unknown')`                                         | every `AgencyPersonnel` producer, by rule D2                                                                 |
| `reviews.agency_id`                         | `text not null references agency(id)`                                                              | the report's own source: the manual source for curated reports, the submissions source for submitted reports |
| `civil_cases.status`                        | `text not null`, `check in ('Open','Closed','Unknown')`                                            | every `CivilCase` producer, by rule D3                                                                       |
| `agency_phone_numbers.kind`                 | `text not null`, `check in ('Phone','Fax')`                                                        | every `AgencyPhoneNumber` producer, from the source's own label                                              |
| `location_path.state_code`                  | `text null`; required (`check`) when `level = 'state'`, null otherwise                             | the Census gazetteer source, from the USPS code it supplies                                                  |
| `location_path.administrative_area_kind_id` | `text null references administrative_area_kind(id)`; required when `level = 'administrative_area'` | the Census gazetteer source, from the Census legal/statistical area description                              |
| `personnel.deceased_message`                | `check (deceased_on is null and deceased_source is null) or deceased_message is not null`          | every producer that reports a death                                                                          |

`administrative_area_kind` is a manual-records table: `id`, `name` (for example `County`, `Parish`, `Borough`, `Census Area`), `plural_name` (`Counties`, `Parishes`). It replaces the suffix rules in the projection script.

Status columns hold the reader-facing word. The site shows it as stored. The alternative, a lowercase code plus a label table, adds a join for three fixed values; it is listed as an open question.

`reviews.agency_id` records the agency the report is about, as the report source states it. It is not taken from `review_personnel`. A report may name officers at other agencies; the agency column is still one recorded fact.

### D2. Employment status rule (intake's documented rule)

Intake sets `employment_status` per assignment from what the source says:

- `Former` when the assignment has an `end_date`.
- `Current` when the assignment has no `end_date` and the source is a roster of current staff that lists the assignment in its latest acquired snapshot (for example the TCOLE current appointments and the MN POST current roster, which already emit `end_date` null explicitly).
- `Unknown` in every other case.

The rule is written in `docs/` and in each source's README. Each source states which of its inputs is a current roster. A value is a resolved property, cached through the `ResolvedProperty` adapter. Because `intake-date-validation` already omits future dates, no "start date after today" case remains.

The effective date substitution the site used (`data_source_values->effective_value` for a null date) stops. Intake writes the effective date into `start_date` and `end_date`. If a source supplies a date only as unparseable text, the column stays null and the existing validation annotation keeps the original text.

### D3. Civil case status rule

- `Closed` when the source reports `date_terminated` or a final outcome.
- `Open` only when the source states the case is pending.
- `Unknown` otherwise.

This follows owner answer Q19: "pending and other states only when intake actually determined the state."

### D4. License action types

Two manual-records tables:

- `license_action_type`: `id`, `name` (the collapsed public label, shown as "License Action"), `category` with `check in ('discipline','commendation','other')`.
- `license_action_text`: `id`, `source_text` (the exact source action text, unique), `license_action_type_id` (not null).

`license_action` gains `license_action_type_id text not null references license_action_type(id)`. The shared import resolves it from `license_action.action` through `license_action_text` as a resolved property. An action text with no row fails generation with the text and the source record named. `license_action.action` keeps the source text.

The collapse is not decided. Task 3.1 lists every distinct source action text from the TCOLE, MN POST and Oregon DPSST transforms and proposes the smallest set of types. The owner reviews it before any row is written.

### D5. Annotation message codes

`data_annotation` gains `message_code text not null references data_annotation_message(code)`. `data_annotation_message` is a manual-records table: `id`, `code` (unique, stable, for example `standardized_text`), `message` (plain English, no markup). The site joins `message_code` to `data_annotation_message` and shows `message`.

The change `type-annotation-envelopes` already proposes the code and the table. If it is applied first, this change only adds the codes listed in the specs. If this change is applied first, it creates the column and table with the shape that change describes, and that change drops the duplicate task.

The finding code that ADR 0040 already gives each finding is the message code. Messages must not contain internal IDs or slugs (the current duplicate-exclusion message does).

### D6. Text standardization

A manual kind, `StandardValue`, holds one entry per exact value: subject kind, field, `source_value`, `standard_value`, and a reason. A shared stage in `data generate` applies the entries after property corrections and before validation. For each record whose field equals a `source_value`, the stage writes `standard_value` and adds a correction finding with message code `standardized_text`. The shared import turns it into a correction annotation, with the original value and the replacement value. Raw inputs and `data_source_values` keep the original.

For enumerated columns (`license.status`, `license_action.status`, `agency.status`) an unknown value fails generation, as for license action texts.

For free text (all-caps `agency.name`, `agency.contact_name`, `location_path.display_name`), entries are written per exact value. A script proposes title-case values for review; no automatic title-case rule runs in the pipeline, because a rule gets names such as "At Law" wrong.

The entries are manual records, not code. No namespace, kind or source ID is special-cased in code.

### D7. Page-selection views

Each view returns IDs and the columns the page needs. The rules are today's rules, moved; only the "current" test changes to the stored `employment_status`.

| View                                 | Rule                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_agency_page`                   | Agency with at least one `agency_personnel` row with `employment_status = 'Current'`, whose place has an `administrative_area` parent under a `state` parent. Returns the canonical path (`location_path.path |     | agency.slug |     | '/'`). |
| `site_location_page`                 | State, area and place rows that contain at least one `site_agency_page` agency. Returns the parent paths and the single child agency or place when there is exactly one (the "one-child shortcut").           |
| `site_personnel_page`                | Personnel with at least one `agency_personnel` row.                                                                                                                                                           |
| `site_personnel_listing`             | Personnel with at least one `Current` assignment at a `site_agency_page` agency.                                                                                                                              |
| `site_federal_agency_branch`         | `site_agency_page` agencies with a `parent_federal_agency_id`.                                                                                                                                                |
| `site_report_page`                   | Every `reviews` row, with its canonical path from the stored location path, the UTC incident date and the slug, and its agency from `reviews.agency_id`.                                                      |
| `site_civil_case_page`               | Every `civil_cases` row the site builds a page for, by the current site rule (task 6.1 records the rule).                                                                                                     |
| `site_topic_page`                    | One row per scope (agency, location, federal agency) and topic (`reports`, `civil-cases`) where the count in D8 is above zero.                                                                                |
| `site_agency_staff_other_civil_case` | For an agency, civil cases linked through `civil_case_personnel` to other `agency_personnel` rows of the same personnel ("cases from staff members' other jobs"), with the other assignment's agency.         |

The view names start with `site_` so the build's read surface is easy to find. The view also returns the location state, area and place path segments, so the site does not split paths.

### D8. Public count views

Every count is distinct and comes from recorded rows. Civil-case scopes follow the website `AGENTS.md` rule.

| View                             | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_agency_count`              | `current_personnel_count` (distinct `personnel_id` with a `Current` assignment), `report_count` (distinct `reviews` with that `agency_id`), `civil_case_count` (distinct cases linked to that agency's own `agency_personnel` rows), `discipline_count` (distinct `discipline` rows linked through `discipline_agency_personnel` to that agency's rows)                                                                                                                |
| `site_location_count`            | `agency_count` (`site_agency_page` agencies located within), `current_personnel_count` (distinct personnel with a `Current` assignment at those agencies), `any_assignment_personnel_count` (distinct personnel with any assignment at agencies within; the `/personnel/` state map uses it today), `report_count` (distinct reports whose `location_path_id` is within), `civil_case_count` (distinct cases linked to `agency_personnel` rows of every agency within) |
| `site_personnel_count`           | `agency_count`, `report_count`, `civil_case_count`, `open_civil_case_count` (`status = 'Open'`), `discipline_count` (discipline from any source, owner answer Q29), `discipline_license_action_count` (`license_action_type.category = 'discipline'`)                                                                                                                                                                                                                  |
| `site_federal_agency_count`      | `branch_count`, `current_personnel_count`, `report_count`, `civil_case_count` over its branches                                                                                                                                                                                                                                                                                                                                                                        |
| `site_licensing_authority_count` | the counts the licensing-authority pages show; task 6.1 lists them                                                                                                                                                                                                                                                                                                                                                                                                     |

"Within" uses `location_path_closure` (D9), not path prefixes.

### D9. Build projections in the database

| Relation                | New form                                                                                | Notes                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `location_path_closure` | recursive view over `location_path.parent_location_path_id`, all rows                   | Today it holds only eligible locations. Every consumer joins it to agencies or reports, so the wider set changes no count.                                                                                             |
| `agency_zip_index`      | view: `left(agency.zip_code, 5)` for `site_agency_page` agencies with a ZIP             | The `00000` filter is dropped: shared address validation already rejects placeholder ZIPs. Same columns as today.                                                                                                      |
| `build_page_payload`    | materialized view with the same columns, built with `jsonb_build_object` from D7 and D8 | Unique index on `path`, so a duplicate path fails the refresh, as the script fails today. `content_hash` is the SHA-256 of the payload's `jsonb` text, so every hash changes once. `generated_at` is the refresh time. |

`public.refresh_site_projections()` refreshes every materialized view in dependency order and then runs `public.assert_site_projections()`, which raises on the conditions the script checks today: an agency without a location path, a report without an agency, a location whose level or parent does not match.

Map positions: place, area and state map points come from the stored `location_path.centroid` and `location_path.bbox`, not from averaged agency coordinates. A location without them gets no map point. Agency map points stay the agency's own coordinates.

Who calls the refresh: the build, at the point where it runs the script today. `data up` does not refresh, because `data up` only applies recorded mutations. This is an open question for the owner.

### D10. What cannot move to the database

- **Sorting with the website's `Intl.Collator` (numeric, base sensitivity).** Sorting is formatting, allowed to the site. Views do not promise an order.
- **Count phrases** such as "3 places" or "agencies located here". These are copy built from a count; they stay site formatting.
- **Map bound padding** (18 percent, at least 0.02 degrees). It is presentation; the view returns the stored bounding box.
- **`NO_PERSONNEL`.** A build setting, not content.

### Website follow-up (cross-repo note, not intake tasks)

These are work items for the `policeconduct.org` repository after this change is applied:

- Delete `scripts/refresh-build-projections.mjs`; call `select public.refresh_site_projections()` instead.
- Read `site_*` views for page selection and counts; delete the duplicate SQL in `agencies.ts`, `agency-detail.ts`, `personnel.ts`, `federal-agencies.ts`, `civic-index.ts`, `civic-topic-records.ts`, `report-archives.ts` and `[slug]/index.astro` `getStaticPaths` queries; delete `currentAssignmentSql`.
- Show `employment_status`, `civil_cases.status`, `reviews.agency_id`, `license_action_type.name` and `category`, `agency_phone_numbers.kind` (no call link for `Fax`), `location_path.state_code` for map tiles, `administrative_area_kind.name` and `plural_name`.
- Join `data_annotation_message` for annotation text; stop showing raw field names once field labels exist (open question).
- Remove the hard-coded `US_STATE_TILES` names and `STATE_NAMES`.

## Risks / Trade-offs

- [The new `NOT NULL` columns need values for every row] → Filled by regenerating all sources in `data reset`. No migration backfills rows.
- [Employment status from sources that do not say "current"] → Those assignments become `Unknown`, and agencies whose only assignments are `Unknown` lose their agency page. Task 2.2 counts them before the reset, and the owner reviews the list.
- [Report counts change meaning] → Today an agency's report count follows `review_personnel`; with `reviews.agency_id` a report counts once, under its recorded agency. The difference is reported before release (task 6.4).
- [Location personnel counts change meaning] → Today a place sums agency counts, so a person at two agencies counts twice. The view counts distinct people. Reported before release.
- [Materialized views can be stale] → The build refreshes them before it reads. A refresh failure fails the build.
- [The website breaks between the intake release and the website follow-up] → Accepted by the owner; fixed afterward.
- [Many standard-value entries for all-caps names] → Proposed by a script, reviewed in bulk, written through the manual source.

## Migration Plan

1. Land migrations in this order: manual-records tables; new columns; standard values; views; materialized views and functions; drop the old projection tables.
2. Add the manual records (license action texts and types after owner review, messages, administrative area kinds, standard values).
3. Run `data reset` against a database with no other rebuild in progress.
4. Run the integrity assertions in task 7.
5. Rebuild production the same way, then deploy the website follow-up.

Rollback: revert the migrations and run `data reset` from the previous commit.

## Open Questions

1. Status words: store `Current`/`Former`/`Unknown` and `Open`/`Closed`/`Unknown` as shown, or lowercase codes plus a label table? The site used to show "Ongoing"; is `Open` the right public word?
2. Employment status when a roster stops listing an assignment that has no end date: `Former` or `Unknown`?
3. Should intake's agency inclusion rule (`agency-record-selection`: assignments with a null effective `end_date`) switch to `employment_status = 'Current'`, so inclusion and agency pages use the same test? Agencies included only as civil-case roots or federal offices have no agency page today; is that intended?
4. Report agency for existing manual reports: which agency when a report links officers at two agencies?
5. Agency report count: by `reviews.agency_id` (proposed) or by linked personnel (today)?
6. Location personnel count: distinct people (proposed) or the sum of agency counts (today)? Should the `/personnel/` state map count current staff only, like every other personnel count?
7. License action collapse: the proposed type set and categories need owner review (task 3.1). Are action texts unique across licensing authorities, or must `license_action_text` be keyed by authority?
8. Annotation field labels: the site used to relabel `location_path_id` as "Administrative area". Should intake add a manual table of field labels per subject kind, or should the message name the field (owner answer Q43)?
9. Who refreshes the materialized views: the website build (proposed) or an intake command after `data up`?
10. Is there a website section for "cases from staff members' other jobs"? No current website code uses one; the view is proposed because the owner named it.
11. Deferred inventory items, each needing its own decision: preferred coverage copy and alias target on `coverage_links` (release news); a display-record column on `data_annotation` for junction kinds; a typed link kind on `civil_case_links` (CourtListener link); roster provenance text; collection status per scope; a primary assignment if the profile headline should return.
12. Production database: is production rebuilt by `data reset` like local, or does it need a separate migration path?
