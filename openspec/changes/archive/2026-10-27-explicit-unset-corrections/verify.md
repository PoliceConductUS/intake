## Verification

- Before implementation, three CLI tests failed: literal null became a null value, unset was unavailable, and suffix null text cleared the field.
- 34 focused tests pass across CLI, correction IO/application, and import correction errors.
- CLI tests verify persisted literal `"null"`, numeric-field rejection without a write, literal `--from null` matching a string field, unset persistence without a value, conditional nonmatches, and explicit null overriding an existing database value during generation.
- OpenSpec: 50 passed, zero failed.
- Type checking remains blocked by pre-existing missing `readSourceName` ledger methods and related test doubles.
- Migrated the 60 previously approved TCOLE null correction records through canonical PropertyCorrection IO to explicit unset operations. Preserved original command provenance and a JSON snapshot of the prior entries in the existing TCOLE correction report directory. The 12 non-null corrections are unchanged.

## Validation boundary restoration

The separately requested rollback restores the original Personnel schemas. Corrections remain in generation; no pipeline reorder or cross-stage correction provenance is needed. Explicit unset and the saved corrections remain intact. No reset or database write was performed.
