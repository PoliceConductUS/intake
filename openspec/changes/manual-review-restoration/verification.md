# Verification

- Regression tests failed before implementation for unsupported Review acquisition
  and replacement ReviewPersonnel ID; both pass after the changes.
- Full manual-source and data-context suites: 67 passed, one failure in the existing
  civil-case source ordering assertion at data-context.test.ts:2203. It expects
  Original summary -> Second source summary but concurrent preparation produces
  the reverse order. This change does not modify civil-case resolution.
- Focused manual/ReviewPersonnel tests: 3 passed, 65 skipped.
- Typecheck and build passed. OpenSpec validation: 23 passed.
- Normal CLI applied workspace mutation 000008: one Review, three ReviewPersonnel,
  two ReviewLink creates; 61 existing manual location entries were read unchanged.
- Read-only database verification matched the original report ID, stored slug,
  narrative, date, coordinates, location, personnel relationship IDs/ratings and
  both evidence URLs. Four other historical reviews remain absent.
- Subsequent manual generation produced an empty diff.
- Workspace evidence: intake-workspace/dev-copy/audits/manual-review-20260924/.
  No direct database writes, schema changes, reset, source download or deployment.
