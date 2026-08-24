# Tasks

## 1. Schema

- [x] Add `supabase/migrations/20260824170000_provenance_structural_invariant.sql`
      as a purely additive migration. No existing table is altered or dropped.
- [x] Provenance spine: `source`, `source_retrieval` (append-only, locator
      constrained), `claim_predicate`, `claim` with `retrieval_id NOT NULL`.
- [x] Publication lifecycle: `publication_status` enum, `subject_suppression`,
      append-only `publication_event` written by trigger.
- [x] Agency identity: `agency_entity`, `agency_entity_member`, `agency_ori`
      with explicit `ori_form` and generated `ori7`, `ori_conflict` queue with
      detection trigger, `agency_registry_presence`.
- [x] Personnel identity: attribute-free `person`, `person_name_variant`,
      `employment_period`, `person_identity_link`.
- [x] Render surface: `render` schema, `render.cite()`, `render.published_claim`,
      `render.published_agency`, gated `render.published_person`.
- [x] Least-privilege `page_renderer` role with an explicit two-view allowlist
      and default privileges revoked for future objects.
- [x] All primary keys are `text` with no `DEFAULT`, per the repo ID policy that
      the database must never generate durable IDs. The one exception is
      `publication_event.event_id`, which is an append-only log row rather than
      a durable entity; this is stated in a comment on the trigger function.

## 2. Enforcement

- [x] Add `public.assert_provenance_invariant()` returning violations.
- [x] Add `scripts/assert-provenance-invariant.ts` and the `assert:provenance`
      npm script so CI fails on a weakened invariant.
- [ ] Wire `assert:provenance` into the CI workflow after `supabase db reset`.
      Not done here: the CI workflow lives outside this repo's `validate` script
      and changing it needs the deploy owner. Tracked separately.

## 3. Verification

- [x] Add `test/schema/provenance-invariant.test.ts` — 42 tests, each attempting
      the thing the invariant forbids and asserting refusal.
- [x] Add `test/schema/upstream-fixture.sql`, applied only when `public.agency`
      is absent so the suite exercises the real schema when one is present.
- [x] Assert `current_user = 'page_renderer'` before the permission tests. The
      first draft passed all four permission tests while connected as the
      superuser, because `pg` ignores the `user` option when `connectionString`
      is set. Without this guard the suite reports a false green on the single
      most important assertion in the change.
- [x] `npm run test:vitest` passes with and without `TEST_DATABASE_URL`
      (suite self-skips when absent).
- [x] `npm run typecheck` passes.
- [x] `npm run format:check` passes.
- [ ] Run the suite against a real `supabase db reset` database. Not done here:
      PostGIS is unavailable on the verification host, so the full 45-table
      migration set could not be applied locally. **Required before merge.**

## 4. Supabase And Contract Validation

- [x] No generated type refresh required — no existing table changes shape.
- [x] No data reset required — the migration is additive.
- [x] No seed rows added, so no post-seed integrity assertions are needed.
- [ ] `npm run lint:sql` (sqlfluff) not run — requires `mise`/`uvx`, unavailable
      on the verification host. **Required before merge.**
- [ ] `npm run openspec:validate` not run — the `openspec` binary is not
      installed here. **Required before merge.**

## 5. Deliberately Not In This Change

- Backfilling the 132,109 live personnel pages onto the claim model. They have
  no retrieval records to point at, and manufacturing a citation for a value
  whose origin cannot be demonstrated is worse than having none. Blocked on
  INS-11.
- Retiring the legacy value columns on `agency`, `officers`, `agency_officers`.
- Opening the personnel gate. Requires Data Integrity & Publication Risk
  Reviewer clearance plus a reviewable migration and grant.
- Applying this migration to production. That is a separate decision with a
  deploy owner.
