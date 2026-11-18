## Implementation

- [ ] `data acquire` (with and without `--from-local`): write the command's log through `createIntakeLog` and pass that logger to the source; record a thrown error as the last record; tests.
- [ ] `data transform`: the same; tests.
- [ ] `data reset`: the same for the reset's own command folder; tests.
- [ ] `cache set`, `cache unset`, `cache alias` and `photo`: the same; tests.
- [ ] Update the README files under `src/` that describe these commands' side effects.

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
- [ ] Run one acquire on the dev workspace and assert its folder holds a log whose lines match the terminal output.
