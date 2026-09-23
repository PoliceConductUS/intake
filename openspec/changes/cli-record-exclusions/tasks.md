- [x] Add regression tests for CLI persistence, existing-entry preservation, validation, duplicates, and the existing dependency cascade.
- [x] Implement the command with shared exclusion IO and document its transform requirement.
- [x] Run focused tests (18 passed), typecheck, build, and OpenSpec validation (18 items passed).
- [x] Use the CLI to exclude TCOLE Agency 515001, regenerate TCOLE artifacts without acquisition, and verify the exclusion and dependent records.

Verified the 2026-09-22T23-43-39-039Z transform through canonical Artifacts IO against the prior 2026-09-22T03-51-43-534Z transform: Agencies 2,949 → 2,948 (only 515001 removed); AgencyPhoneNumbers 5,498 → 5,497 (only its dependent phone removed); AgencyPersonnel 170,487 unchanged; all 129,929 Personnel keys retained. No acquisition, mutation generation, database application, or reset was run.

- [x] Move CLI exclusion writes and transform reads to existing source workspace state; cover workspace isolation and unchanged repository files.
- [x] Move existing exclusions and correction audit files into the durable workspace, preserving records and reasons.
- [x] Verify focused tests, typecheck, build, OpenSpec, and unchanged TCOLE transform results.

Workspace storage verification: 21 focused tests passed, including CLI workspace isolation and actual transform filtering from workspace exclusions. Typecheck, build, formatting, and all 18 OpenSpec items passed. Migrated all 54 TCOLE exclusions with identical file bytes and moved the 33-row manual-place list and 94-row correction audit into `$INTAKE_WORKSPACE/audits/tcole-location-corrections-20260922/`. Updated audit links after relocation.

The 2026-09-23T04-21-25-975Z transform completed successfully. Canonical Artifacts IO compared every record against 2026-09-23T04-04-02-217Z: 1 LicensingAuthority, 12 AuthorityLicenses, 2,899 Agencies, 129,929 Personnel, 152,977 Licenses, 188,036 LicenseActions, 170,372 AgencyPersonnel, and 5,449 AgencyPhoneNumbers are identical. Database status still shows 000001–000004 applied and 000005 pending. No acquisition, reset, generation, or database application was run for this storage change.
