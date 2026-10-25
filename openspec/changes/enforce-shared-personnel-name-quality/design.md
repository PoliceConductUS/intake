## Shared boundary

Personnel field types live in `src/shared/personnel-name-schema.ts`, referenced by
the entity spec generator. Generated artifact/create schemas and update-field
schemas therefore enforce the same rules. Canonical IO, corrections and replay
consume those schemas; a new source needs no validation hook.

Reject names without Unicode letters, not words that resemble placeholders.
Suffix vocabulary is inherited from PR #80. Invalid values fail closed, retaining
raw evidence. No suffix is inferred and no real surname is classified as a
fixture by spelling. The Texas transform no longer discards candidates or clears
unsupported suffixes before shared validation.

Existing namespace-scoped exclusion IO supplies the explicit exception path.
Its foreign-key cascade removes assignments/dependents. The audited fixture
packet is applied through the existing CLI during the parent-owned rebuild,
never loaded as hidden source-specific policy.

## Historical comparisons

Name-quality refinements mark their errors `currentValueOnly`. Generated updates
waive only these refinements for historical `from` values, enabling repairs of
legacy bad data. Required types, timestamps and other checks are unchanged.
Replacement `to` values still receive every check, and replay still compares
`from` to the stored value before updating.

## Operational consequences

This is deliberately stricter than silently clearing suffixes. Existing inputs
with unsupported names now stop until reviewed. It is not a corpus repair or a
publication authorization. There are no migrations or shared-database writes.
