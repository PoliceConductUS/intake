# Verification

- Generator regression: 2 tests pass; both originally failed on the old generator.
- TypeScript check: passes.
- OpenSpec validation: 32 items pass, zero failures.
- Scoped source/template formatting and git diff checks: pass.
- Generated document uses the local live schema and includes the maintained request template; repeated generation is byte-identical.
- Requested scope verified: raw activity and justice outcomes, demographics, jail and deaths, force, employment and compensation history, FTO/supervisors, beats/shifts/timekeeping, GIS shapes, task forces, funding/expenses, complete data catalog, standard request, and redaction dictionary/log with unpadded R1/R2/R3 examples.
- Independent review: native-export reshaping contradiction corrected; final review has no material findings.

This change documents requested data and changes the provider-document generator. It does not add database tables, canonical IO, native-export parsers, or migrations. Existing unrelated worktree edits were preserved.
