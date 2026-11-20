## Depends on

Each is archived before implementation starts.

- `move-complaint-summaries-to-generate`: its complaint findings, including `complaint-mismatch`, use the flat shape (ADR 0038 status note), and this change moves them.
- `report-every-left-out-source-record`: it adds flat-shape findings to every source, and this change moves them.
- `publish-source-data-annotations` (intake): its specs are among those this change reconciles.
- `fix-licensing-authority-annotations` (policeconduct.org): it makes record pages show only the label and the message (decision 3).
- `cache-call-results-and-files` and `cache-every-acquire`, if open question 4 references retained files as `binary_file` records; `keep-state-under-one-root`, if it keeps a `state-folder` base.

## Design

- [x] Record the design as ADR 0038, status Proposed.
- [ ] Rebuild a database with today's code and `data reset --no-acquire`, compare it with the database this change's rebuild would replace, and settle every difference with the owner (open question 2).
- [ ] Settle open questions 1 to 6 of `design.md` with the owner and record the answers in `design.md`, ADR 0038, the proposal and the spec, including the row's columns, the list of annotation kinds, the message codes and wording, the locator, how each producer's evidence maps to sources, and the paths of the files to be created.
- [ ] Write the deltas that reconcile this change with every spec the proposal lists under Modified Capabilities, in intake and in a policeconduct.org change, and update ADR 0040's description of a finding and ADR 0033's revisit trigger for a chain that starts again.
- [ ] Mark ADR 0038 Accepted when this change is approved.

## Phase 1: Schema, annotation kinds and sources

The shared import and the sources build `Finding`s together, so they move in one phase.

- [ ] Write the Supabase migration for the annotation kind, the payload, the message code, and where the wording is kept, with the move of existing annotations chosen in open question 2, and a test that the migration fails when `public.data_annotation` holds a row if open question 2 chooses (b). Apply every migration with `npm run supabase:reset`.
- [ ] Change `scripts/lib/entity-spec-generator.ts` and `scripts/generate-envelope-types.ts` for the new shape and run `npm run generate:envelope-types` and `npm run generate:data-request-doc`.
- [ ] Define the annotation kinds, the source shapes and their canonical IO, with tests: a round trip for each kind, an unknown key, an annotation that does not match the kind it names (also through an update), a public source URL that is not `http` or `https`, a source that does not say which sort it is, and an intake reference that keeps a sheet and row.
- [ ] Write the message codes and their wording, and what writes them where open question 1 puts them.
- [ ] Move the shared import (`Finding`, validation findings, corrections, resolver findings, `DataContext`) to the new shape, keeping the naming of decision 1, and update its tests: `test/import/artifacts/native-annotations.test.ts`, `test/import/artifacts/data-annotations.test.ts`, `test/import/artifacts/inspect-data-annotations.test.ts`, `test/import/artifacts/record-metadata.test.ts`, `test/import/artifacts/source-value-defects.test.ts`, `test/import/artifacts/data-context.test.ts`, `test/import/entity-facade.test.ts`, `test/import/artifacts/cache-correction-errors.test.ts`, `test/cli/property-corrections.test.ts`, `test/cli/cache.test.ts`, `test/import/annotation-mutations.integration.test.ts`, `test/import/findings.integration.test.ts`, `test/import/complaint-summary.integration.test.ts`, `test/import/artifacts/complaint-summary-resolvers.test.ts`, `test/cli/transform/exclusion-annotations.test.ts` and `test/data-request-doc.test.ts`.
- [ ] Move every source listed in the proposal to the new shape and update its tests, including `test/oregon-transform.test.ts` and `test/sources/lib/state-authority-findings.test.ts`.
- [ ] Change the manual source's interview so an operator can write an annotation in the new shape, and update `test/sources/org.policeconduct.manual/manual.test.ts`.
- [ ] Write the move of the manual `DataAnnotation` records and of any `PropertyCorrection` entry the new shape cannot read, chosen in open question 2, with a test that it stops naming an entry it cannot move (and update `test/cli/workspace/migrate-state.test.ts` if it uses `workspace migrate-state`).
- [ ] Test that a `data generate` whose mutations are applied, followed by a second `data generate` with unchanged findings, writes no annotation mutation.
- [ ] Update the READMEs and help text that describe the finding and annotation shape or the published `--message` and exclusion reason: `README.md`, `src/shared/README.md`, `src/shared/io/README.md`, `src/cli/import/artifacts/README.md`, `src/cli/import/artifacts/io/README.md`, `src/cli/import/artifacts/facades/README.md`, `src/cli/cache/README.md`, `src/cli/data/README.md`, `src/cli/workspace/README.md`, `src/cli/transform/README.md`, `sources/lib/README.md`, the README of each source listed in the proposal, and the help in `src/cli/data/index.ts` and `src/cli/cache/index.ts`.
- [ ] Run `npm run validate`.

## Phase 2: Contract and website

- [ ] Change `scripts/publish-data-annotation-contract.ts` to publish every annotation kind's schema, run `npm run validate`, and publish it with `npx tsx scripts/publish-data-annotation-contract.ts <policeconduct.org>/src/lib/data/annotation-contract.json`. Publish the import schemas with `INTAKE_WORKSPACE` set and `npm run publish:import-schemas`.
- [ ] Change the policeconduct.org files listed in the proposal, with the schema check in `annotation-values.js` enforcing `enum`, `pattern` and `format`, and with tests: a kind with a component, a kind with no component, a public source URL that is not `http` or `https` fails the check, markup characters in a message shown as written, a wording change shown after a build, no intake reference on any page or in any CSV, and the replacements chosen in open question 5. Run its `npm test` and `scripts/validate-schema-contract.mjs`.

## Phase 3: Rebuild and rollout

- [ ] Write the production migration plan from `design.md`'s Migration Plan and the answers to open questions 2 and 5, with its rollback.
- [ ] Back up the database the rebuild will replace, hold writes to it, and save its annotation IDs and names and its archived evidence.
- [ ] On a clone of the workspace and a database other than production, run the move of workspace state and `data reset --no-acquire`.
- [ ] Assert on the rebuilt database: the set of annotation IDs, active and resolved, equals the saved set; every record table with an `id` holds the same IDs as the database being replaced, leaving out `data_mutation_applied` and `build_page_payload`; the archived evidence is kept as open question 2 decides; every annotation's subject exists; every message code resolves to one wording; every annotation's kind matches its message's kind; every stored kind has a published schema; and every row has the columns open question 3 fixes. If open question 4 or 6 adds referenced rows, assert that each one's annotation and `binary_file` exist.
- [ ] Carry out step 6 of the Migration Plan (contract, website, production, workspace, build) and run the checks again against production.
