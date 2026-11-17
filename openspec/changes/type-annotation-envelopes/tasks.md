## Design

- [x] Record the design as ADR 0038, status Proposed.
- [ ] Mark ADR 0038 Accepted when this change is approved.

## Implementation

- [ ] Define the annotation envelope kinds, the source shapes and their canonical IO, with tests.
- [ ] Write the Supabase migration for the typed payload, the kind, the message code and the messages table with explicit IDs, rewriting existing rows with their IDs kept; reset and apply every migration.
- [ ] Move the shared import and every producing source to the new shape, with tests.
- [ ] Publish the annotation schemas with the import schemas.
- [ ] Run `npm run validate`, including OpenSpec and Supabase validation, and assert every rewritten annotation's subject exists and its ID is unchanged.
- [ ] Change the policeconduct.org annotation components in that repository.
