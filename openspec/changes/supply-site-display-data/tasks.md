## 1. Approval and records

- [ ] 1.1 Get owner answers to the open questions in `design.md` and record them in `design.md`.
- [ ] 1.2 Write an ADR, status Proposed: "The site reads database views" (fact columns, selection and count views, projections in the database, refresh function).

## 2. Fact columns

- [ ] 2.1 Write the migration for `agency_personnel.employment_status`, `reviews.agency_id`, `civil_cases.status`, `agency_phone_numbers.kind`, `location_path.state_code`, `location_path.administrative_area_kind_id`, the `administrative_area_kind` table and the `personnel.deceased_message` check; regenerate envelope types.
- [ ] 2.2 Before the reset, list per source how many assignments would be `Current`, `Former` and `Unknown`, and which agencies would lose their agency page; give the list to the owner.
- [ ] 2.3 Document the employment status rule in `docs/` and in each `AgencyPersonnel` source README; implement it as a resolved property in each source, with tests per scenario.
- [ ] 2.4 Write effective assignment dates into `start_date` and `end_date` in each source, with tests.
- [ ] 2.5 Supply `reviews.agency_id` from the manual source and the submissions source; add `agency_id` to every existing manual `Review` record through the CLI.
- [ ] 2.6 Implement the civil case status rule in each `CivilCase` producer, with tests.
- [ ] 2.7 Map the phone kind in each `AgencyPhoneNumber` producer, with tests.
- [ ] 2.8 Supply `state_code` and the area kind from the Census gazetteer source; add the `administrative_area_kind` manual records.
- [ ] 2.9 Supply `deceased_message` in every producer that reports a death.

## 3. License action types

- [ ] 3.1 List every distinct `license_action.action` text from the TCOLE, MN POST and Oregon DPSST transform outputs, with counts and producers; propose the smallest set of types with categories; get owner review.
- [ ] 3.2 Write the migration for `license_action_type`, `license_action_text` and `license_action.license_action_type_id`; add both kinds to the manual source `HANDLED_RECORD_KINDS`.
- [ ] 3.3 Resolve `license_action_type_id` in the shared import and fail on unknown text, with tests.
- [ ] 3.4 Add the reviewed records through the manual source.

## 4. Annotation message codes

- [ ] 4.1 Confirm whether `type-annotation-envelopes` lands first; if not, write the migration for `data_annotation.message_code` and `data_annotation_message` with that change's shape.
- [ ] 4.2 Make every annotation producer report its finding code as the message code, and fail on a code with no message, with tests.
- [ ] 4.3 Add the messages for `standardized_text`, `excluded_duplicate`, `excluded_record`, `administrative_correction` and every existing finding code, in plain English with no IDs or slugs.

## 4a. Annotations about a person

- [ ] 4a.1 Write the migration for `data_annotation.licensing_authority_id` (`text null references licensing_authority(id)`) with a check that it is set for every person subject kind in `design.md` D11; regenerate envelope types.
- [ ] 4a.2 Make every producer of an annotation about a person supply the licensing authority in the annotation envelope, keeping `subject_kind` and `subject_id` on the person record, with tests per scenario in `specs/person-annotation-attachment/spec.md`.

## 5. Text standardization

- [ ] 5.1 Add the `StandardValue` manual kind with canonical IO and tests.
- [ ] 5.2 Add the shared standardization stage to `data generate` after property corrections, with the correction finding, and fail on unknown values for enumerated columns, with tests.
- [ ] 5.3 Write a script that proposes standard values for the corrections-queue columns; review the proposals; add them through the manual source.

## 6. Selection and count views

- [ ] 6.1 Read the website (read-only) and list every page-selection rule and every public count it shows, including the civil case page rule and the licensing-authority page counts; record the list in `design.md`.
- [ ] 6.2 Write the migration for the `site_*` page-selection and chain views, with SQL tests per scenario.
- [x] 6.3 Write the migration for the count views `site_agency_personnel_employment`, `site_agency_count`, `site_federal_agency_count`, `site_personnel_state_count` and `site_personnel_count`: done in `supabase/migrations/20261122000000_site_public_counts.sql`.
- [ ] 6.3a Write the migration for the remaining count views and columns in `design.md` D8 ("Still to do": `site_location_count`, `site_licensing_authority_count`, and the report, civil-case and discipline columns), with SQL tests per scenario, including the civil-case scope rules.
- [x] 6.3b Get the owner's decision on the agency current count (`current_assignment_count`, today, or `current_personnel_count`; `design.md` open question 14) and record it in `design.md`: distinct people (2026-11-22), in `supabase/migrations/20261122100000_site_agency_personnel_counts.sql`.
- [ ] 6.4 Compare each new count with the website's current count on a copy of the current data; report every difference to the owner before release.

## 7. Build projections

- [ ] 7.1 Write the migration that drops the `build_page_payload`, `location_path_closure` and `agency_zip_index` tables and recreates them as views and a materialized view.
- [ ] 7.2 Write `public.refresh_site_projections()` and its checks, with SQL tests for each failure.
- [ ] 7.3 Compare the new `build_page_payload` rows with the script's rows on a copy of the current data; report every difference.

## 8. Validation

- [ ] 8.1 Run `npx openspec validate supply-site-display-data` and `npm run openspec:validate`.
- [ ] 8.2 Run `npm run supabase:reset` to apply every migration, then `data reset` on a database with no other rebuild in progress.
- [ ] 8.3 Assert integrity: every `reviews.agency_id`, `license_action.license_action_type_id`, `license_action_text.license_action_type_id`, `location_path.administrative_area_kind_id`, `data_annotation.message_code` and `data_annotation.licensing_authority_id` resolves; every annotation about a person has a `licensing_authority_id`; no `NOT NULL` column is null; every annotation's subject exists; existing record IDs and slugs are unchanged.
- [ ] 8.4 Run `npm run validate`.
