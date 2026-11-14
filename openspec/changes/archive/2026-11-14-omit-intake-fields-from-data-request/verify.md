# Verification Report

**Change**: `omit-intake-fields-from-data-request`
**Verified at**: `2026-11-13`
**Verifier**: Claude Code (written by hand; the `openspec-verify-change` skill is not installed in this repo)

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] All items `"valid": true`

```text
51 items, 0 invalid
```

---

## 2. Task Completion (`tasks.md`)

- [x] Every task is `- [x]`

---

## 3. Delta Spec Sync State

| Capability              | Sync state | Note                                         |
| ----------------------- | ---------- | -------------------------------------------- |
| `data-request-document` | Needs sync | One added requirement; applied when archived |

---

## 4. Design / Specs Coherence Spot Check

| Sample                      | brainstorm.md                             | specs                                                     | Gap  |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------- | ---- |
| Institute-controlled fields | Nine named fields omitted on every record | Requirement lists the same nine fields                    | None |
| Institute-produced records  | Three record types omitted                | Scenario "The schema has Institute-produced record types" | None |
| Document matches generator  | Test compares committed files with output | Scenario "The committed document is compared"             | None |

**Drift warnings**: `Agency.status` and `status_date` remain in the document
and have not been ruled on. This change has no `design.md`; the bridge treats
it as optional.

---

## 5. Implementation Signal

- [x] Changes for this change are committed and pushed on
      `chore/agent-guardrails` (PR #94)

Evidence:

- `test/data-request-doc.test.ts` failed before each generator change and
  passes after it.
- `test/generated-files.integration.test.ts` failed against the stale
  document and passes against the regenerated one.
- `npm run validate` passed on the merged tree: 184 test files, 1876 tests,
  none skipped.

---

## 6. Front-Door Routing Leak Detector

- [x] `docs/superpowers/specs/` contains no files

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` has no deferred steps.

---

## Overall Decision

- [x] PASS WITH WARNINGS: `brainstorm.md` and `plan.md` were written by hand
      after the user decided the scope directly, not produced by the
      Superpowers skills the bridge names.

**Next step**: archive the change so the added requirement lands in
`openspec/specs/data-request-document/spec.md`.
