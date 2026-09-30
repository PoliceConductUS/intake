# Retrospective

## Evidence

Four source-update suppression paths were removed: three configurable facade overrides and one streamed geometry existence check. The final focused run passed 121 tests across 12 files; typecheck, formatting, diff checks, and 26 OpenSpec validations passed. No commits or live data writes occurred.

## Findings

The initial literal configuration search found only three remaining overrides. Independent review found the same behavior outside that configuration in the geometry stream. Auditing behavior as well as option names was necessary to enforce the prohibition.

The skips concealed spatial and numeric read-type mismatches. Real CLI regressions exposed both before replay could be claimed correct. Shared database read adapters now match the existing envelope types, with precision and unchanged-rerun tests.

Review also caught an attempted narrowing of geometry payloads to strings. Existing streaming fixtures established object payload support; the final comparison preserves both existing forms.

Repository guidance now explicitly rejects using reads to suppress edits or bypass errors. Stable identity is not immutable content. Existing explicit read/assertion envelopes remain supported.

## Remaining scope boundary

A timestamp precision edge case in the earlier report change is recorded in verify.md as a separate follow-up. No additional timestamp contract was introduced during this fix.

> **Update 2026-09-26**: The timestamp follow-up is resolved by the report change's fractional truncation and calendar-date validation. [Completion verification](verify.md#completion-verification--september-26-2026) records the fresh combined full-suite run: 836 tests passed across 115 files. Both changes are being archived together.
