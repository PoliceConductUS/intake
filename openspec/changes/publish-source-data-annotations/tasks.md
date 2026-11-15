## 1. Shared contracts and migration

- [x] 1.1 Keep existing required geography/routes per the user decision; require explicit correction or exclusion and attach exclusion findings to the explicitly mapped licensing authority. Reconcile the superseded date-omission change and audit affected canonical contracts.
- [x] 1.2 Add the native annotation schema and forward migration preserving old evidence; retain original literals where typed columns cannot represent them.
- [x] 1.3 Regenerate envelope/mutation/database types from their owning generators; verify strict shared IO and stable identity.

## 2. Import preservation

- [x] 2.1 Preserve negative/long/future date values and their source evidence during import; reuse detection rules during ordinary generation.
- [x] 2.2 Remove factual-defect omission at source and shared pipeline gates while retaining structural integrity failures and explicit exclusions.
- [x] 2.3 Generate native findings from effective values in the existing generate stage; ordinary up/replay apply only recorded mutations.
- [ ] 2.4 Exercise the five audited TCOLE records and scheduled Oregon employment through generation/apply; verify stable canonical IDs and retained personnel/assignments.

- [x] 2.5 Capture applied correction details in generated mutations, with independent canonical identities and scoped status updates; support annotation-only updates when corrected values are unchanged.
- [x] 2.6 Test two providers and two source IDs in one namespace mutating the same owner, unprocessed contributions, nonmatching overrides, multiple mutations in one run, and correction/warning coexistence.

## 3. Website display and publication

- [x] 3.1 Add shared annotation loading/rendering beside affected data, including reported dates, correction explanations, original/replacement values and supplied evidence.
- [x] 3.2 Build the shared annotation collection with original values, source identifiers, record labels and public URLs.
- [x] 3.3 Generate the central paginated provider/type-filtered index and all-matching CSV downloads.
- [x] 3.4 Add explicit source-to-authority attribution and linked authority annotation subpages, type filters, empty states and full-result downloads.

## 4. Verification and rollout

- [ ] 4.1 Run focused intake tests and type checks, plus disposable migration/reset/seed validation and existing post-seed integrity assertions. If any new referenced seed row is necessary, give it a checked-in ID and assert its presence and relationships.
- [ ] 4.2 Run focused site tests for display, filters, pagination, attribution and CSV completeness, then verify a generated preview across profile/central/authority routes.
- [x] 4.3 Run `npm run openspec:validate`; reconcile specification conflicts before archiving.
- [ ] 4.4 Apply the forward migration and regenerated imports through normal release procedures, rebuild the site and verify published counts/links. Do not reset production.

## Follow-up: retired scoring cleanup

- [x] Remove the disabled agency scoring trigger and 15 unused scoring functions with a forward migration, without CASCADE.
- [x] Verify absence, replay safety, and preservation of the unrelated timestamp function in disposable PostgreSQL.

Verification scope: the audited date pairs and scheduled employment pass synthetic generation/apply regressions; original source artifacts and identities were inspected read-only. Original-corpus regeneration and production rollout in 2.4/4.4 remain release work. Disposable schema validation and local browser verification pass; a complete seeded/static production build in 4.1/4.2 is not claimed.

## Follow-up: POST source issue annotations

- [ ] Capture structured POST-source issues, including automatic omissions and explicit exclusions, and attach them to the explicitly identified licensing authority with source identifiers, reasons, and evidence references. Preserve unverified identity status and trace dependent omissions to their cause.
- [ ] Verify DPSST missing-agency omissions, explicit personnel exclusions and their dependents, rerun replacement, and authority HTML/CSV visibility. Existing explicit-exclusion support covers only part of this requirement; automatic DPSST omission logs are not yet annotations.

## Multiple source contact emails

- [x] Accept semicolon-separated valid email addresses without altering source evidence; retain errors for invalid or empty members.
- [x] Verify full intake validation and downstream separate email rendering.

- [x] Generate annotations within normal source generation; verify unchanged source values can clear obsolete findings and up/replay apply only recorded changes.

- [x] Add native singular/plural canonical IO, registry and source-name ledger integration.
- [x] Produce annotation records during ordinary generation and apply them through ordinary mutations.
- [x] Verify manual/source coexistence, stable IDs, resolve/reactivate lifecycle, JSON evidence, and subject references in disposable PostgreSQL.
