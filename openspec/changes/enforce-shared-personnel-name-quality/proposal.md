## Why

INS-96: Texas-only checks do not protect Oregon, future sources, manual imports,
or mutation replay. Name-like placeholder words can also be real names.

## What Changes

- Enforce nonblank, letter-bearing first, middle, and last names in shared field
  schemas; nullable optional components remain nullable. Validate suffixes against
  the existing generational suffix vocabulary, without guessing replacements.
- Reject invalid supplied values visibly before writing. Retain raw inputs and
  field-scoped errors. Confirmed fixtures use existing reason-bearing exclusion
  data, with dependency cascading, rather than a name-word blacklist.
- Preserve historical update `from` values as evidence, validating `to` values.
- Test Texas, Oregon, and an arbitrary future namespace through shared boundaries.

## Impact

No migration, seed changes, database reset, or production operations. Generated
schema contracts change along with their generator. Existing invalid artifacts
must be explicitly corrected or excluded before rerunning. Parent INS-69 owns
corpus rebuild and publication verification.
