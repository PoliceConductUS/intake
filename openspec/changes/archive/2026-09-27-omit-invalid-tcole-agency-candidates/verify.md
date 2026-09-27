# Verification Report

**Change:** omit-invalid-tcole-agency-candidates
**Verified:** 2026-09-27
**Implementation:** 98a71c5 and 7b4e2ea

## 1. Structural validation

`npm run openspec:validate` and `openspec validate --all --json`: 28 items passed, zero failed. All four task checkboxes are complete. Commit evidence and task-progress prechecks both returned positive counts.

## 2. Task completion

Source omission, shared validation, generated contracts, regression coverage, and the authorized local TCOLE regeneration/application/audit are complete. No deferred tasks remain.

## 3. Delta spec sync

The agency-record-selection delta adds visible source rejection and shared field validation. Archive synchronized both requirements into the durable capability spec.

## 4. Design and spec coherence

- TCOLE validates candidates through canonical AgencySpec, logs source IDs and invalid fields, and omits invalid agencies and dependent assignments/contacts.
- Shared city/address validators reject only the approved exact tokens after trimming/case-folding. ZIP validation accepts ZIP5 or ZIP+4 with a nonzero five-digit prefix. Leading-zero ZIPs and unapproved ambiguous addresses remain accepted.
- Generator fieldTypes apply before optionality; artifact fields remain optional and creates require them. Artifacts, creates, updates, and corrections share field validation. Unrelated strings are unchanged.
- Existing update validation still checks both old and new values. One stored Minnesota agency has ZIP 551554047; correcting that old invalid value requires a separate decision. No Minnesota change was made.

## 5. Implementation and verification evidence

Implementation is committed in 98a71c5 and 7b4e2ea. The worktree was clean after the implementation commit; remaining changes at verification are lifecycle documentation only.

- Source/schema subset: 49 files, 319 tests passed.
- Full suite: 119 files passed, one failed; 880 tests passed and one timed out in the unchanged seed display test at 5 seconds. Its separate rerun passed both tests unchanged in 2.78 seconds. No test assertion failure remained.
- Typecheck, build, scoped Prettier, and git diff checks passed.
- Independent code review found no implementation blocker.
- Red-green evidence: null-invalid source regressions failed before source validation; placeholder source regressions failed before shared validators; shared contract tests had eight expected failures before implementation.

Local data entry 000012 applied four inserts: one agency, one assignment to an existing person, and two phones. The raw TCOLE department is marked INACTIVE but has a null-ended assignment, so it qualifies under the accepted root rule. Source validity rejected 162 agencies, including 51 of 55 manually excluded agencies. Four semantic exclusions remain.

The post-application audit found zero lost records, zero changed existing URLs, and no orphans across 43 foreign-key relationships. All 12 applied entries verify; no pending entries remain. The 44 previously identified TCOLE personnel omissions remain outside the qualifying graph. Audit evidence is in `$INTAKE_WORKSPACE/audits/agency-selection-20260927/report.md` and its adjacent JSON/log files.

## 6. Front-door routing

No design documents exist under docs/superpowers/specs. No schema migrations, seed changes, dependencies, reset, or remote database writes were introduced.

## 7. Deferred manual checks

None. Real TCOLE transformation, generation, application, and integrity checks ran locally. The Minnesota correction-contract question is separate follow-up work, not an unperformed TCOLE check.

The named openspec-verify-change skill is unavailable. Verification followed the explicit fallback checks in the superpowers-bridge schema.

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS — the full run had one timeout; the unchanged isolated rerun passed. The existing invalid Minnesota ZIP is documented for separate follow-up.
- [ ] ❌ FAIL

Capability specification synchronized and change archived locally. No merge, push, or site deployment was performed.
