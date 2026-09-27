# Plan

1. Add transform-to-Artifacts regressions for invalid city, address, and ZIP, including dependent omissions; observe failure.
2. Validate candidate agencies with canonical AgencySpec and omit failures visibly.
3. Verify focused tests, typecheck, and OpenSpec validation. Resume regeneration, audit, and apply the authorized database delta.

4. Add regression tests for exact placeholder rejection, field-specific scope, ZIP format, optional artifacts and required creates, and update values. Implement shared field validators and regenerate contracts. Run focused generator/IO/source tests and typecheck. Regenerate source artifacts and mutations afterward.
