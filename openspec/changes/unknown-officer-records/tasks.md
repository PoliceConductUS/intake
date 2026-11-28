## 1. Owner choice (pending)

- [ ] 1.1 Present options A, B and C with the comparison in `design.md`; record the owner's choice and answers to the open questions in `design.md`.

## 2. Implementation (pending owner choice; rewrite this group for the chosen option)

- [ ] 2.1 Pending owner choice: write the migration for the chosen option (B: `civil_case_agency`, the consistency check and `agency_unknown_officer_record`; A: the discriminator and exclusions in every `site_*` view; C: nullable `personnel_id` with a check).
- [ ] 2.2 Pending owner choice: add the annotation codes and messages, and produce the findings in the arrest, report and civil case sources, with tests.
- [ ] 2.3 Pending owner choice: update the specs of `agency-record-selection` (option B) or of assignment identity (option C).

## 3. Validation (pending owner choice)

- [ ] 3.1 Run `npx openspec validate unknown-officer-records` and `npm run openspec:validate`.
- [ ] 3.2 Run `npm run supabase:reset`, then `data reset` on a database with no other rebuild in progress.
- [ ] 3.3 Assert integrity: every unknown-officer record links to an existing agency and carries its annotation; no staff count or personnel page includes an unknown officer.
- [ ] 3.4 Run `npm run validate`.
