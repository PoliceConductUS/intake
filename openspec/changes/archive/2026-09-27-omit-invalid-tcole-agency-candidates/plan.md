# Plan

1. Add transform-to-Artifacts regressions for invalid city, address, and ZIP, including dependent omissions; observe failure.
2. Validate candidate agencies with canonical AgencySpec and omit failures visibly.
3. Add regression tests for exact placeholder rejection, field-specific scope, ZIP format, optional artifacts and required creates, and update values. Implement shared field validators and regenerate contracts.
4. Verify source/IO tests, typecheck, build, formatting, and OpenSpec validation. Run the full suite and investigate any failures.
5. Regenerate source artifacts and mutations. Audit and apply the authorized local database delta, then check retained identities, URLs, foreign keys, and outstanding omissions.
