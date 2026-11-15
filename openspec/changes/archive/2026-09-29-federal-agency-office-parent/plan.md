# Implementation plan

1. Specify the direct parent model and independent federal office eligibility.
2. Add failing producer, selection, and database-backed regression tests.
3. Add the FK migration and regenerate canonical Agency contracts.
4. Emit source parent names and declare federal root/edge metadata.
5. Transform preserved source state, generate and inspect the mutation delta,
   apply it locally, and verify all 11 offices and existing identities.
6. Run relevant tests, type checking, build, SQL lint, OpenSpec validation, and review.
