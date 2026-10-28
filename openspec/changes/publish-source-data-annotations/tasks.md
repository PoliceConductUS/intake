## 1. Shared contracts and migration

- [ ] 1.1 Keep existing required geography/routes per the user decision; require explicit correction or exclusion and attach exclusion findings to the explicitly mapped licensing authority. Reconcile the superseded date-omission change and audit affected canonical contracts.
- [ ] 1.2 Add the shared annotation schema and record-owned JSON columns through a new migration; retain original literals where typed columns cannot represent them.
- [ ] 1.3 Regenerate envelope/mutation/database types from their owning generators; verify strict shared IO and stable identity.

## 2. Import preservation

- [ ] 2.1 Preserve negative/long/future date values and their source evidence during import; reuse detection rules in the final database scan.
- [ ] 2.2 Remove factual-defect omission at source and shared pipeline gates while retaining structural integrity failures and explicit exclusions.
- [ ] 2.3 Add one post-mutation annotation stage after the full batch succeeds; inspect final records and atomically replace warnings/errors, clearing obsolete findings while preserving correction annotations. Test failed batches, failed scans, and no-pending-mutations refresh.
- [ ] 2.4 Exercise the five audited TCOLE records and scheduled Oregon employment through generation/apply; verify stable canonical IDs and retained personnel/assignments.

- [ ] 2.5 Capture applied correction details in generated mutations, with explicit per-owner/namespace/source-ID replacement scopes and empty sets; support annotation-only updates when corrected values are unchanged.
- [ ] 2.6 Test two providers and two source IDs in one namespace mutating the same owner, unprocessed contributions, nonmatching overrides, multiple mutations in one run, and correction/warning coexistence.

## 3. Website display and publication

- [ ] 3.1 Add shared annotation loading/rendering beside affected data, including reported dates, correction explanations, original/replacement values and supplied evidence.
- [ ] 3.2 Build the shared annotation collection with original values, source identifiers, record labels and public URLs.
- [ ] 3.3 Generate the central paginated provider/type-filtered index and all-matching CSV downloads.
- [ ] 3.4 Add explicit source-to-authority attribution and linked authority annotation subpages, type filters, empty states and full-result downloads.

## 4. Verification and rollout

- [ ] 4.1 Run focused intake tests and type checks, plus disposable migration/reset/seed validation and existing post-seed integrity assertions. If any new referenced seed row is necessary, give it a checked-in ID and assert its presence and relationships.
- [ ] 4.2 Run focused site tests for display, filters, pagination, attribution and CSV completeness, then verify a generated preview across profile/central/authority routes.
- [ ] 4.3 Run `npm run openspec:validate`; reconcile specification conflicts before archiving.
- [ ] 4.4 Apply the forward migration and regenerated imports through normal release procedures, rebuild the site and verify published counts/links. Do not reset production.

## Follow-up: retired scoring cleanup

- [x] Remove the disabled agency scoring trigger and 15 unused scoring functions with a forward migration, without CASCADE.
- [x] Verify absence, replay safety, and preservation of unrelated timestamp behavior in disposable PostgreSQL.
