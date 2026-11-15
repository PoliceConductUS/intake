## 1. Model and importer

- [x] 1.1 Record the approved direct parent model and selection behavior.
- [x] 1.2 Add failing regressions for parent emission and office eligibility.
- [x] 1.3 Add and validate the migration; regenerate contracts and documentation.
- [x] 1.4 Emit parent references and fix selection through shared metadata.

## 2. Data and verification

- [x] 2.1 Transform the preserved source and inspect its mutation delta.
- [x] 2.2 Apply locally and verify all 11 parent relationships and canonical IDs.
- [x] 2.3 Verify a repeat import produces no changes.
- [x] 2.4 Run tests, type checking, build, SQL lint, OpenSpec validation, and review.

- [x] 2.5 Preserve initial agency lists throughout a reset or initially empty update; verify with an earlier office import.

- [x] 2.6 Cover every registered resolver and shared primitives for omission/null; fix the shared defects and verify PUT/PATCH updates.
