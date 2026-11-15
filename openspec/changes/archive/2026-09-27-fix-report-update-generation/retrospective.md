# Retrospective

The manual source and transformed artifacts contained the revision. The Review resolver discarded it by producing a read for every existing row. `data generate` therefore reported an empty diff without comparing the content.

The earlier repair used internal APIs to author mutations after normal generation skipped the report. Although `data up` applied those entries, this bypassed the intended workflow and left the bug in place. The correction is to exercise the failed CLI sequence in a regression and fix the resolver. Existing applied history is retained rather than rewritten.

No schema change, source-specific bypass, or extra update mechanism is needed. Use the existing generic diff path and its unchanged-row filter.

> **Update 2026-09-26**: The validation evidence in [verify.md](verify.md#timestamp-failure-and-requested-title-restoration) records the subsequent incident-date serialization failure. Its explicit-timezone section records the user-approved input requirement and tests closing the timezone ambiguity. The initial prose-only regression omitted incident_date and therefore missed a failure present in the real report.

> **Update 2026-09-26**: The user subsequently limited incident timestamps to whole-second resolution. [Whole-second verification](verify.md#whole-second-resolution) supersedes the earlier fractional-precision handling: nonzero fractions are rejected and custom fractional reconstruction is removed.

> **Update 2026-09-26**: The user then chose truncation instead of rejection. [Fractional truncation](verify.md#fractional-truncation) is the final behavior: preserve source timestamps, discard fractions before conversion for generation/writes/comparison, and retain explicit timezone validation.

> **Update 2026-09-26**: Final review found that JavaScript Date rolled impossible calendar dates forward. [Calendar-date verification](verify.md#final-review-calendar-date-preservation) records the failing regressions and shared validation fix that preserves rejection of invalid incident dates.
