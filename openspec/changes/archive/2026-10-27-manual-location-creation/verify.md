# Verification

- The new real-PostgreSQL regression tests initially failed because manual acquisition rejected LocationPath.
- After enabling LocationPath, acquisition, transform, import, same-import aliases, stable re-import, reconstruction by replay, and missing-parent rejection pass.
- Source ordering exposed a cycle because the automatic update loader ignored the manual source's existing standalone flag. A regression invoking the actual update-order helper failed before the loader was corrected, then passed.
- Final focused suite: 6 files, 25 tests passed, including disposable PostgreSQL databases initialized from the current migrations.
- Type checking, build, and OpenSpec validation passed (13 items).

The user's database and intake workspace were not modified. This change enables manual creation; it does not populate the 29 missing communities or assign agencies to them. No migration is required.
