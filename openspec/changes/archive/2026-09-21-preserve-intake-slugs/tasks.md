## 1. Preserve slugs in import and replay

- [x] 1.1 Add failing tests for same-ID database preservation, cache reuse, and stale replay; confirm producer slugs remain non-authoritative.
- [x] 1.2 Implement the smallest transform/planning/replay corrections without changing IDs.
- [x] 1.3 Run focused tests and review the changes.

## 2. Correct the affected local dataset

- [x] 2.1 Audit exact-ID personnel, agency, and location-path slugs against reference CSVs.
- [x] 2.2 Retain before/after evidence and restore verified bad slugs and cached values.
- [x] 2.3 Verify zero remaining targeted mismatches and no ID changes.

## 3. Verify delivery

- [x] 3.1 Run relevant tests, type checking, formatting, and OpenSpec validation.
- [x] 3.2 Record results, review, and remaining deployment boundary.
