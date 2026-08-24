# Tasks

## 1. Schema

- [x] Add `supabase/migrations/20260824190000_corrections_and_takedown.sql` as a
      purely additive migration. No existing table is altered or dropped.
- [x] Intake: `correction_request` with `correction_request_kind`,
      `correction_request_channel`, and `correction_request_disposition` enums;
      substance immutable after insert; not deletable; resolution must name a
      decider.
- [x] Boundary: `enforce_legal_demand_routing` refuses to resolve a
      `legal_demand` or `sealed_or_expunged` request that was not escalated, and
      refuses to decline a suspected sealed record at all.
- [x] Re-import durability: `suppression_source_key`, populated by trigger at
      suppression time; `is_subject_suppressed`, `is_id_suppressed`, and
      `is_source_key_suppressed` lookups; `claim_suppression_guard` checking
      both the canonical ID and the upstream record key.
- [x] Legacy entity guard: `agency_suppression_guard` and
      `officers_suppression_guard` refuse UPDATE and DELETE on a suppressed row.
- [x] Audit: `subject_suppression` DELETE refused; UPDATE restricted to the lift
      fields, once, with a required `lift_note`; apply and lift both write
      `publication_event`.
- [x] `restage_claims_on_lift` returns claims to `staged` on lift rather than
      restoring the prior publication status.
- [x] Least-privilege `intake_writer` role: DML on data tables, SELECT-only on
      `subject_suppression`, `suppression_source_key`, `publication_event`, and
      `source_retrieval`.
- [x] Public surface: `render.corrections_log` and
      `render.corrections_reason_label`, granted explicitly to `page_renderer`.
- [x] All primary keys are `text` with no `DEFAULT`, per the repo ID policy. The
      only generated ID is `publication_event.event_id`, which keeps the
      append-only-log exemption stated in the provenance migration.

## 2. Enforcement

- [x] `public.assert_suppression_invariant()` returns violations for: the
      ingestion role holding write access to suppression state or to the audit
      trail; an actively-suppressed subject reachable through a render view;
      requester identity exposed to the page role; a legal demand resolved
      without escalation.
- [x] `assert_provenance_invariant()` redefined to widen its render-view
      allowlist to include `corrections_log`. Its other four checks are
      unchanged and the function is restated in full so the diff shows that.
- [x] `scripts/assert-suppression-invariant.ts` and the `assert:suppression`
      npm script, mirroring `assert:provenance`, for CI.

## 3. Pipeline

- [x] `src/cli/database/suppression.ts` reads active suppressions through the
      same role that cannot write them.
- [x] `classifyDatabaseOperations` reads suppression state itself rather than
      accepting it as a parameter, and demotes a suppressed row from `update` to
      `read`, so a honoured takedown costs one skipped record rather than an
      aborted import.

## 4. Validation

- [x] `test/schema/corrections-takedown.test.ts` — 26 tests against a real
      Postgres, covering each clause of the issue's done-when: suppression takes
      effect, survives a re-import under both the same and a new canonical ID,
      and is logged. Skips when `TEST_DATABASE_URL` is absent.
- [x] `test:schema` npm script runs the schema suites with
      `--no-file-parallelism`. Both suites reset the `public` schema, so running
      them concurrently against one database is a race.
- [x] Verified 68/68 schema tests pass against PostgreSQL 18.4 from a clean
      database.
- [x] Verified `assert_suppression_invariant()` is not vacuous: granting the
      ingestion role UPDATE on `subject_suppression` makes it exit 1 with
      `intake_can_modify_suppression`.
- [x] `npx tsc -p tsconfig.json --noEmit` clean.
- [ ] Verify against a real `supabase db reset` database, not just the
      fixture, once PR #60 is merged. Tracked with the same verification as
      INS-30.

## 5. Follow-ups filed, not done here

- [ ] Source-key plumbing for `public.agency` and `public.officers`. Those
      tables carry no `source_record_key`, so re-identification cannot be
      blocked in the database for the legacy corpus that renders the 132,109
      live personnel pages. Needs source record keys threaded through
      `ImportRows`.
- [ ] Surface suppressed-record skips in the load's change diff.
- [ ] Public `/corrections/` page on policeconduct.org, reading
      `render.corrections_log`. Blocked until this migration is applied to the
      real database; a page querying a view that does not exist yet would fail
      the site build.
