- [x] Add regression tests for CLI persistence, existing-entry preservation, validation, duplicates, and the existing dependency cascade.
- [x] Implement the command with shared exclusion IO and document its transform requirement.
- [x] Run focused tests (18 passed), typecheck, build, and OpenSpec validation (18 items passed).
- [x] Use the CLI to exclude TCOLE Agency 515001, regenerate TCOLE artifacts without acquisition, and verify the exclusion and dependent records.

Verified the 2026-09-22T23-43-39-039Z transform through canonical Artifacts IO against the prior 2026-09-22T03-51-43-534Z transform: Agencies 2,949 → 2,948 (only 515001 removed); AgencyPhoneNumbers 5,498 → 5,497 (only its dependent phone removed); AgencyPersonnel 170,487 unchanged; all 129,929 Personnel keys retained. No acquisition, mutation generation, database application, or reset was run.
