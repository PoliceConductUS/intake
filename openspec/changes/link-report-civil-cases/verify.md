# Verification

Completeness: all four tasks and both requirements are implemented. The migration permits exactly one URL+title target or case reference, retains required report identity, enforces the case FK and unique report-target pairs, and generates matching canonical schemas and dependency metadata. Full and partial canonical correction paths have regression coverage.

Migration `20261113000000` was applied to the existing local database without a reset. Manual source acquisition, transformation, and generation emitted exactly one guarded `ReviewLinkUpdate`, mutation `000017`. It preserved ID `ttcbwuea0vqyjfwtpj89as97`, cleared the copied URL/title, and set `civil_case_id` to `ogecfxi5p67286qbmvkfjoa4`. Reapplying the chain found zero pending entries. All 11 report-link records remain present.

`mise exec -- npm run validate` passed: 180 test files, 1,842 tests, zero skips; formatting, typecheck, build, and 48 OpenSpec items passed. The website's full validation passed: 318 Node tests and 213 browser tests, zero skips, including actual same-tab navigation to the current case title and stored slug. Three independent reviews found no remaining issues after two PATCH regressions were fixed.

Clean install uses Node 24.21.0/npm 11.19.0, with 394 installed package versions matching the lockfile (namecase's published v1.1.2 normalizes to 1.1.2). Audit reports zero vulnerabilities and installation emits no warnings. Existing parser dependency APIs were checked with 23 real XLSX/TIGER tests and the full suite. The encoding replacement preserves legacy DBF character sets. Version-pinned install scripts are reviewed and declared. `TMPDIR = false` removes inherited invalid relative paths, preserving test assertions and usable Unix sockets. No warning or coverage exception was used.

Final commit identifiers and validation results are recorded in the completion report. The commit includes the existing AI summary work. No production migration, reset, publication, push, or deployment occurred; the owning branch has no open PR. Verification passed without unresolved findings.
