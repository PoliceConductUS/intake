# Verification

## Current prompt and reset behavior

The prompt-edit regression first failed because the evidence reader required the old numeric version and rejected fingerprint metadata. After implementation, a completed result loads with the current prompt and fails after prompt text changes without a numeric version increment.

The stale-retained-input reset regression first observed schema reset before the stale reader failure. It now fails before schema reset, retains the original mutation file and restores the exact acquisition pointer. Malformed non-string pointers also demonstrated RED before reader validation and now fail before any schema or data command.

Focused verification: 135 Minnesota tests and 47 pointer/reset-related tests passed. Full `npm run validate` exited zero: 182 test files, 1,864 tests, zero skips, typecheck/build/format/OpenSpec passed (49 items). Node 24.21.0 was used; all 394 installed packages match the unchanged lockfile. Dependency installation was already fresh from the preceding validated commit; no dependencies changed.

A fresh reviewer inspected prompt/cache invalidation, retained evidence reuse, pointer restoration and reset ordering. The malformed-pointer finding was fixed with the regression described above. The fresh follow-up review approved the pointer and environment-check fixes with no remaining actionable findings. Final-head validation remains pending.

## Operational input transition

The current prompt is byte-for-byte identical to the version-2 introduction. The user selected exact verification and metadata conversion instead of regenerating all current summaries. All 531 current acquired results passed the new fingerprint reader with preserved PDFs and page evidence. All 70 obsolete results have current results for identical PDF hashes and were replaced using those current analyses. Originals are retained privately. No state cache files, raw PDFs or database rows were directly edited by this transition.

## Diagnostic dispositions

The environment check referenced a deleted seed-linking script even though seed loading is retired. The obsolete seed detection/install calls were removed; shell syntax and a fresh doctor run passed. Superpowers availability was verified by reading the applicable installed instructions. Supabase reports that a newer major CLI release exists; the repository's pinned CLI successfully exercised the migrations against its separate PostgreSQL integration-test databases. This release notice does not identify a failing check or a data defect; no dependency upgrade is included in this fix.

## Database reset comparison

A full recoverable private database archive was created and read back before reset. The reset rebuilt Census, manual locations, federal agencies, Oregon and Texas before encountering the old Minnesota result contract. After the source-result repair, rebuilding continued through the same canonical transform/generate/apply commands without another destructive reset. Rebuild completion, derived projections, exact all-table comparison and final PR-head evidence remain pending.
