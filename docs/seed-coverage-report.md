# seed.sql coverage / gap report

_Generated 2026-08-30. Maps every table in `supabase/seed.sql` (the OLD website
data dump, old schema) to its NEW-schema equivalent and to the config-driven
intake source (if any) that reproduces it._

## Executive summary

**seed.sql cannot be retired yet, but the blocker set is small and mostly
hand-curated data, not bulk records.** The bulk tables (agencies, officers,
assignments, civil cases, federal agencies) are all reproduced _by model_ — a
current source produces the corresponding NEW-schema kind — but only for the
states/scopes the sources cover: **Texas (gov.tx.tcole), Minnesota (mn-post),
and federal agencies (gov.us.federal-le)**. seed.sql holds **3,003 agencies /
130,026 officers nationwide**; the sources reproduce only the TX+MN+federal
slice, so the nationwide remainder is a scope gap, not a schema gap. The
`*_stats` tables, the entire old scoring/report model (traits, rubrics, tags,
ratings), and the operational tables (audit_logs, profiles) are safe to drop —
they are derived aggregates, superseded by the narrative report model (ADR 0029),
or website-runtime tables that were never intake data. The genuine blockers are
all tiny and hand-curated: **the 5 old reviews + 7 review_officers**, **2
agency_links** (no source produces `AgencyLinks` at all), the **hand-curated
coverage_links (7) and their entity links**, **coverage_link_reports (1)** (no
review coverage-link kind exists in the new schema), and the orphaned
**location_reports / location_report_sources (1 each)** which have a DB table but
no intake record kind. These must be carried by the manual source (which today
only handles `LocationPathAlias`) or re-entered through the submissions bucket.

## Old → new table map

| seed table                    |   rows | new table                           | producing source(s) → RecordKind                                | status                                                  |
| ----------------------------- | -----: | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| agency                        |   3003 | agency                              | gov.tx.tcole, mn-post, gov.us.federal-le, manual → `Agency`     | COVERED (partial: TX/MN/federal only)                   |
| agency_stats                  |   2995 | —                                   | —                                                               | GAP-OK (derived aggregate; `drop_unused_stats_tables`)  |
| officers                      | 130026 | personnel                           | gov.tx.tcole, mn-post → `Personnel`                             | COVERED (partial: TX/MN only)                           |
| officers_stats                | 130025 | —                                   | —                                                               | GAP-OK (derived aggregate)                              |
| agency_officers               | 143754 | agency_personnel                    | gov.tx.tcole, mn-post → `AgencyPersonnel`                       | COVERED (partial: TX/MN only)                           |
| agency_officers_stats         | 143753 | —                                   | —                                                               | GAP-OK (derived aggregate)                              |
| agency_phone_numbers          |   5502 | agency_phone_numbers                | gov.tx.tcole → `AgencyPhoneNumbers`                             | COVERED (partial: TX only)                              |
| audit_logs                    |    632 | —                                   | —                                                               | GAP-OK (operational website table)                      |
| tags                          |     77 | —                                   | —                                                               | GAP-OK (superseded scoring/tag model, ADR 0029)         |
| rubrics                       |     75 | —                                   | —                                                               | GAP-OK (superseded scoring model; `drop_scoring_model`) |
| review_officers_ratings       |     57 | —                                   | —                                                               | GAP-OK (superseded scoring model)                       |
| civil_cases                   |     51 | civil_cases                         | clearinghouse-api, courtlistener → `CivilCases`                 | COVERED-by-model (see caveat)                           |
| civil_case_officers           |     49 | civil_case_personnel                | clearinghouse-api, courtlistener → `CivilCasePersonnel`         | COVERED-by-model (see caveat)                           |
| civil_case_links              |     48 | civil_case_links                    | clearinghouse-api, courtlistener → `CivilCaseLinks`             | COVERED-by-model (see caveat)                           |
| traits                        |     15 | —                                   | —                                                               | GAP-OK (superseded scoring model)                       |
| coverage_link_agency_officers |     12 | coverage_link_agency_personnel      | mn-post, youtube.policeactivity → `CoverageLinkAgencyPersonnel` | COVERED-by-model (see caveat)                           |
| review_officers               |      7 | review_personnel                    | org.policeconduct.submissions → `ReviewPersonnel`               | **REAL GAP**                                            |
| review_links                  |      7 | — (no `review_links` in new schema) | —                                                               | **REAL GAP**                                            |
| coverage_links                |      7 | coverage_links                      | mn-post, youtube.policeactivity → `CoverageLinks`               | COVERED-by-model (see caveat)                           |
| rubric_labels                 |      5 | —                                   | —                                                               | GAP-OK (superseded scoring model)                       |
| reviews                       |      5 | reviews                             | org.policeconduct.submissions → `Reviews`                       | **REAL GAP**                                            |
| coverage_link_civil_cases     |      4 | coverage_link_civil_cases           | youtube.policeactivity → `CoverageLinkCivilCases`               | COVERED-by-model (see caveat)                           |
| profiles                      |      2 | —                                   | —                                                               | GAP-OK (operational; `drop_profiles_and_submitter`)     |
| agency_links                  |      2 | agency_links                        | **none** (kind exists, no producer)                             | **REAL GAP**                                            |
| review_tags                   |      1 | —                                   | —                                                               | GAP-OK (superseded tag model)                           |
| location_reports              |      1 | — (DB table only, no record kind)   | —                                                               | **REAL GAP** (orphaned model)                           |
| location_report_sources       |      1 | — (DB table only, no record kind)   | —                                                               | **REAL GAP** (orphaned model)                           |
| federal_agency_branch         |      1 | federal_agency_branch               | gov.us.federal-le → `FederalAgencyBranches`                     | COVERED                                                 |
| federal_agency                |      1 | federal_agency                      | gov.us.federal-le → `FederalAgencies`                           | COVERED                                                 |
| coverage_link_reports         |      1 | — (no coverage-link-to-review kind) | —                                                               | **REAL GAP**                                            |

## Real gaps (what actually blocks retiring seed.sql)

These hold data that no current source reproduces and that would be genuinely
lost. All are small and hand-curated.

1. **reviews (5) + review_officers (7)** → `reviews` / `review_personnel`.
   The submissions source (`org.policeconduct.submissions`) _does_ produce these
   kinds, but it reads only the S3-synced **verified-submissions bucket**; it
   does not contain the 5 legacy hand-entered reviews from the old site. To
   reproduce them they must either be seeded into the submissions bucket as
   verified/approved submissions (so the submissions source emits them), or the
   manual source must learn to emit `Reviews` + `ReviewPersonnel`. Note ADR 0029:
   the old Q&A/traits/rubric scoring is dropped; only the narrative + the officer
   link survive, so re-entry is a narrative conversion, not a 1:1 restore.

2. **review_links (7)** → no equivalent. There is no `review_links` table or
   record kind in the new schema. If these external links must survive, they need
   either a new kind or folding into the review narrative / `coverage_links`.
   Blocker only if the 7 links carry information not already in the reviews.

3. **coverage_link_reports (1)** → no equivalent. The new schema has
   `coverage_link_agency_personnel` and `coverage_link_civil_cases` but **no
   coverage-link-to-review** join. If a coverage link must attach to a review,
   the schema needs that kind; otherwise this row is dropped with the review model.

4. **agency_links (2)** → `agency_links`. The `AgencyLink` kind exists in the
   entity model, but **no source produces `AgencyLinks`** (verified: not in any
   `produces` array). These 2 hand-curated agency URLs must be carried by the
   manual source (extend `HANDLED_RECORD_KINDS`, currently `["LocationPathAlias"]`
   only) or by adding emission to gov.us.federal-le.

5. **location_reports (1) + location_report_sources (1)** → orphaned. A DB
   migration created these tables, but there is no record kind, no `TABLE_BY_KIND`
   entry, and they are absent from `SupportedTableName` — intake cannot write
   them. This 1 hand-curated location report is unreproducible until a record kind
   is added (or the data is judged obsolete and the tables dropped).

6. **Hand-curated coverage links & entity links (caveat rows).**
   `coverage_links (7)`, `coverage_link_agency_officers (12)`, and
   `coverage_link_civil_cases (4)` map cleanly to the new kinds, and mn-post /
   youtube.policeactivity produce them — but those sources generate links from
   MN discipline rosters and PoliceActivity YouTube searches, **not** from the
   specific 7 hand-curated seed links. The _model_ is covered; the _specific
   rows_ are only reproduced if the same links fall out of the automated sources.
   Treat as a partial gap: any hand-curated coverage link not rediscovered by an
   automated source needs the manual source.

7. **civil_cases (51) + civil_case_officers (49) + civil_case_links (48)** —
   COVERED-by-model with a scope caveat. clearinghouse-api and courtlistener
   produce all three kinds, but they fetch live from the Clearinghouse and
   CourtListener APIs with a **min-year filter (default 2022)** and only for
   agencies that have at least one imported officer. The 51 legacy cases will be
   reproduced only insofar as they re-appear from those APIs within that scope;
   pre-2022 or hand-entered cases outside an imported agency will not. Not a hard
   blocker, but verify overlap before dropping.

### Scope gap (not a schema gap, but blocks a full nationwide rebuild)

The bulk tables are COVERED **only for TX + MN + federal**. seed.sql is
nationwide: **3,003 agencies, 130,026 officers, 143,754 assignments, 5,502 phone
numbers**. The intake sources today are gov.tx.tcole (Texas), mn-post
(Minnesota), and gov.us.federal-le (federal). Every other state's agencies and
officers in seed.sql have **no producing source**. This is the largest volume
gap by far, though it is understood/intentional (sources are added state by
state) rather than a lost-data blocker per the memory note that a full rebuild
must be verified before new sources are added.

## Safe to drop (GAP-OK)

- **`*_stats` (agency_stats 2995, officers_stats 130025, agency_officers_stats 143753)** — derived aggregates recomputed by the website; already removed by
  `20260825000200_drop_unused_stats_tables.sql`. Never intake data.
- **Old scoring / report model — tags (77), rubrics (75),
  review_officers_ratings (57), traits (15), rubric_labels (5), review_tags
  (1)** — the Q&A/trait/rubric report scoring is superseded by the narrative
  verbatim model (ADR 0029) and dropped by `20260829000000_drop_scoring_model.sql`.
- **audit_logs (632), profiles (2)** — operational website/runtime tables (audit
  trail, user accounts), never intake data; profiles dropped by
  `20260830000000_drop_profiles_and_submitter.sql`.

## Notes on method

- Coverage is derived from each source's authoritative `export const produces`
  array in `sources/*/transform.ts`, cross-checked against `TABLE_BY_KIND` in
  `src/shared/io/generated/entity-specs.ts`.
- gov.azpost.roster is disabled (`produces = []`), so Arizona contributes nothing
  yet.
- The manual source (`org.policeconduct.manual`) is model-driven and _could_
  carry any kind, but `HANDLED_RECORD_KINDS` currently lists only
  `LocationPathAlias`, so it reproduces none of the gap rows today.
  </content>
