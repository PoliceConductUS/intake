## Implementation

- [x] Correct the two phone cache values and remove their persistent exclusions.
- [x] Add failing shared field-validation and canonical source-artifact regression tests.
- [x] Apply cached corrections before validating phone, email and URL fields across all sources.
- [x] Log defects, omit invalid optional values, and omit invalid required records and dependent links.
- [x] Preserve blank typed source strings until correction and defect handling.
- [x] Run formatting, lint/type checking, all 1,247 tests, build and OpenSpec validation.
- [x] Reset dev-copy through `data reset --no-acquire`; verify corrected phones, zero invalid typed values, and zero non-place agency references.
