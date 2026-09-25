# Retrospective

Census PLACE files alone did not cover townships and other local jurisdictions. The user clarified both the geographic scope (exclude statistical subdivisions) and overlap semantics (prefer city/CDP and retain full original township boundaries while omitting fully covered townships). Those choices now appear in source policy, ADR 0024, OpenSpec and regression tests.

The nationwide audit verified actual source classes, full coverage by unions, path preservation and Alba township. Database tests verified the additive default and actual ST_Covers behavior, including shared edges. Constraining concurrent test workers avoided unrelated container startup timeout contention.

No production or current-development database write, source identity rewrite, new branch, or new worktree was performed. Future Census CONCITY state additions require refreshing the explicit state inventory against the source directory.
