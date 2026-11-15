# Implementation plan

Use the existing isolated worktree and Superpowers TDD/implementation/review workflow.

1. Capture live production sitemap and match TX agency slugs exactly to August14 records and existing source mappings. Record unmatched/explicitly excluded duplicates without inventing mappings.
2. Add strict InitialAgencyRoots canonical IO and namespace-state adapter; add regressions for validation and exact path/namespace. Root will populate the real dataset; implementation agent owns code/tests.
3. Add empty-agency-table gate and pass explicit roots to shared pure graph selection. Test empty database with reference rows, nonempty unrelated agency, closed historical descendants, ordinary open roots, absent/invalid/excluded candidates, and other namespaces without roots.
4. Independent review, targeted and full tests, typecheck/build/OpenSpec validation.
5. Populate canonical TCOLE initial root envelope with captured evidence and run a fresh reset. Audit IDs, slugs, relationships, status, MN ZIP/assignments, and production omissions against preserved baselines; no viewer changes.
6. Record verification/retrospective, sync/archive, commit.
