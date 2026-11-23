## Why

The owner decided on 2026-11-22 that the website is a generated view of the database. It must not filter, select, connect, normalize or decide page content. Website commit `84c5cec` removed those decisions, so pages now lose employment status, report agency, case status, adverse license actions and other details. Counts and page selection still live in website loaders and in the website script `scripts/refresh-build-projections.mjs`. Intake must now supply every missing fact, and the database must define the selection rules, the foreign-key chains and the public counts, so the site only reads them.

## What Changes

- **New fact columns, filled by intake:** `agency_personnel.employment_status`, `reviews.agency_id`, `civil_cases.status`, `agency_phone_numbers.kind`, `location_path.state_code`, `location_path.administrative_area_kind_id`. `personnel.deceased_message` becomes required for every deceased person.
- **License action types:** two manual-records tables, `license_action_type` (the collapsed set, each with a category such as discipline, commendation or other) and `license_action_text` (every exact source action text, linked to one type). `license_action.license_action_type_id` links each action. Intake fails on an action text with no `license_action_text` row.
- **Annotation message codes:** every `data_annotation` row names a `message_code`. The manual-records table `data_annotation_message` maps the code to the public message. The site joins it. This builds on `type-annotation-envelopes`.
- **Text standardization:** intake standardizes the stored text listed in the corrections queue through manual `StandardValue` records. Each change is recorded as a correction annotation.
- **Page-selection views:** `site_agency_page`, `site_location_page`, `site_personnel_page`, `site_personnel_listing`, `site_federal_agency_branch`, `site_report_page`, `site_civil_case_page`, `site_topic_page`.
- **Foreign-key chain views:** `site_agency_staff_other_civil_case` and the report, case and assignment joins the site follows.
- **Public count views:** done in `supabase/migrations/20261122000000_site_public_counts.sql`: `site_agency_personnel_employment`, `site_agency_count`, `site_federal_agency_count`, `site_personnel_state_count` and `site_personnel_count`. Still to do: `site_location_count`, `site_licensing_authority_count`, and the report, civil-case and discipline columns listed in `design.md` D8.
- **Annotations about a person:** intake attaches every annotation whose subject is a person, or a record a person owns, to the licensing authority as well, and keeps the person as the subject. The authority page always shows it; the person's page shows it once that page is built.
- **Build projections move to the database:** `build_page_payload` becomes a materialized view. `location_path_closure` and `agency_zip_index` become views. One function, `public.refresh_site_projections()`, refreshes the materialized views. **BREAKING** for the website: its projection script can no longer write these relations.

## Capabilities

### New Capabilities

- `site-display-facts`: Fact columns intake fills for the site: employment status, report agency, civil case status, phone kind, state code, administrative-area kind and deceased message.
- `license-action-types`: Manual license action texts and types, the link from `license_action`, and failure on unknown text.
- `annotation-message-codes`: The message code on each annotation and the codes the corrections queue needs.
- `stored-text-standardization`: Manual standard values, their application during `data generate`, and the correction annotation for each change.
- `site-page-selection-views`: Views that decide which pages exist and which records a page lists, and views for foreign-key chains.
- `site-public-counts`: Views that define every public count from stored data.
- `person-annotation-attachment`: Annotations about a person are attached to the licensing authority and keep the person link.
- `site-build-projections`: `build_page_payload`, `location_path_closure` and `agency_zip_index` as database relations and their refresh function.

### Modified Capabilities

- `agency-status`: Stored agency status becomes a standardized word, and the original source text is kept in a correction annotation.

## Impact

- **Supabase migrations:** new columns and constraints on `agency_personnel`, `reviews`, `civil_cases`, `agency_phone_numbers`, `location_path`, `personnel`, `license_action` and `data_annotation` (including `data_annotation.licensing_authority_id`). New tables `license_action_type`, `license_action_text`, `administrative_area_kind` and `data_annotation_message`. New views and materialized views. The existing tables `build_page_payload`, `location_path_closure` and `agency_zip_index` are dropped and recreated as views.
- **Intake sources:** every producer of `AgencyPersonnel` (employment status), `Review` (agency), `CivilCase` (status), `AgencyPhoneNumber` (kind), `LicenseAction` (type), the Census location source (state code, area kind), and every annotation producer (message code, and the licensing authority for annotations about a person). The manual source gains the new manual kinds.
- **Generated contracts:** envelope types and import schemas are regenerated (`npm run generate:envelope-types`).
- **Data reset:** required. New `NOT NULL` columns are filled by regenerating every source through `data reset`; no migration backfills rows.
- **Production migration plan:** the production database is rebuilt the same way, then the website follow-up deploys. The website breaks between the two steps; the owner accepted breakage that is fixed afterward (2026-11-20 to 2026-11-22).
- **Downstream contract (website, cross-repo, not intake tasks):** listed in `design.md`, section "Website follow-up".
- **Related changes:** `type-annotation-envelopes` (message table), `import-arrest-records` (arrest tables replace arrest profiles), `unknown-officer-records` (records with a known agency and unknown officer).
- **Open questions:** listed in `design.md`.
