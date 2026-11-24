## Depends on

Each is archived before implementation starts.

- `move-complaint-summaries-to-generate`: its complaint findings, including `complaint-mismatch`, use the flat shape (ADR 0038 status note), and this change moves them.
- `report-every-left-out-source-record`: it adds flat-shape findings to every source, and this change moves them.
- `cache-call-results-and-files`: it makes `BinaryFile` the record kind a file source points at.
- `keep-state-under-one-root`: it removes `publish:import-schemas` and plans the `data reset --no-acquire` that open question 1 recommends reusing.
- `publish-source-data-annotations` (intake): its specs are among those this change reconciles.
- `fix-licensing-authority-annotations` (policeconduct.org): it makes record pages show only the label and the message (decision 7).

## Design

- [x] Record the design as ADR 0038, status Proposed.
- [ ] Amend ADR 0038 with the owner's answers of 2026-11-20: decision 1 (one `DataAnnotation` record with a `kind` column and a typed payload), decision 2 (a file source points at its `BinaryFile` record with a locator; the public part is the source's own URL), decision 3 (audit references only in the transform output and the chain), and decision 4 (templates with named values; the wordings are `DataAnnotationMessage` records in the chain).
- [ ] Rebuild a database with today's code and `data reset --no-acquire`, compare it with the database this change's rebuild would replace, and settle every difference with the owner (open question 1).
- [ ] Settle open questions 1 and 2 of `design.md` with the owner and record the answers in `design.md`, ADR 0038, the proposal and the spec, with the catalogue of message codes and wordings, the `general` and `excluded-record` schemas, how each producer's evidence maps to sources, and the paths of the files to be created.
- [ ] Write the deltas that reconcile this change with every spec the proposal lists under Modified Capabilities, in intake and in a policeconduct.org change, and update ADR 0040's description of a finding and ADR 0033's revisit trigger for a chain that starts again.
- [ ] Mark ADR 0038 Accepted when this change is approved.

## Phase 1: Schema, annotation kinds and sources

The shared import and the sources build `Finding`s together, so they move in one phase.

- [ ] Write the Supabase migration: `public.data_annotation` gains `kind`, `payload`, `message_id` and `binary_file_id` and loses `message` and `evidence`, and `data_annotation_message` holds `id`, `code`, `kind` and `template`, with the move of existing annotations chosen in open question 1 and, if it chooses (a), a test that the migration fails when `public.data_annotation` holds a row. Apply every migration with `npm run supabase:reset`.
- [ ] Change `scripts/lib/entity-spec-generator.ts` (the `DataAnnotationMessage` entity with `code` as its business key, and `DataAnnotation`'s new columns with the check of the whole record against its kind's schema on create and update) and `scripts/generate-envelope-types.ts`, add `DataAnnotationMessage` to `OMITTED_KINDS` in `scripts/lib/data-request-doc-generator.ts`, and run `npm run generate:envelope-types` and `npm run generate:data-request-doc`.
- [ ] Define the `general` and `excluded-record` schemas and the source shapes, with tests: a round trip for each kind, an unknown key, an update that breaks its kind's schema, a public source URL that is not `http` or `https`, a source that does not say which sort it is, and a file source that keeps a sheet and row.
- [ ] Write the catalogue of message codes and templates, and make `DataContext` emit the `DataAnnotationMessage` record of each code its annotations use, with tests: a changed wording is one message update and no annotation update, a template naming a missing value fails, a value its template does not name fails, and an unknown code fails.
- [ ] Move the shared import (`Finding`, validation findings, corrections, resolver findings, `DataContext`) to the new shape, keeping the naming of decision 1 and keeping audit references in the transform output and the chain entry only, and update its tests: `test/import/artifacts/native-annotations.test.ts`, `test/import/artifacts/data-annotations.test.ts`, `test/import/artifacts/inspect-data-annotations.test.ts`, `test/import/artifacts/record-metadata.test.ts`, `test/import/artifacts/source-value-defects.test.ts`, `test/import/artifacts/data-context.test.ts`, `test/import/entity-facade.test.ts`, `test/import/artifacts/cache-correction-errors.test.ts`, `test/cli/property-corrections.test.ts`, `test/cli/cache.test.ts`, `test/import/annotation-mutations.integration.test.ts`, `test/import/findings.integration.test.ts`, `test/import/complaint-summary.integration.test.ts`, `test/import/artifacts/complaint-summary-resolvers.test.ts`, `test/cli/transform/exclusion-annotations.test.ts` and `test/data-request-doc.test.ts`.
- [ ] Move every source listed in the proposal to the new shape, emitting the `BinaryFile` record of each file a file source points at, and update its tests, including `test/oregon-transform.test.ts` and `test/sources/lib/state-authority-findings.test.ts`.
- [ ] Change the manual source's interview so an operator can write an annotation in the new shape, naming a message code from the catalogue, and update `test/sources/org.policeconduct.manual/manual.test.ts`.
- [ ] Write the move of the manual `DataAnnotation` records chosen in open question 1, with a test that it stops naming a record it cannot move.
- [ ] Test that a `data generate` whose mutations are applied with `data up`, followed by a second `data generate` with unchanged findings, writes no annotation or message mutation, and that no annotation row holds an audit reference.
- [ ] Update the READMEs and help text that describe the finding and annotation shape or the published `--message` and exclusion reason: `README.md`, `src/shared/README.md`, `src/shared/io/README.md`, `src/cli/import/artifacts/README.md`, `src/cli/import/artifacts/io/README.md`, `src/cli/import/artifacts/facades/README.md`, `src/cli/cache/README.md`, `src/cli/data/README.md`, `src/cli/workspace/README.md`, `src/cli/transform/README.md`, `sources/lib/README.md`, the README of each source listed in the proposal, and the help in `src/cli/data/index.ts` and `src/cli/cache/index.ts`.
- [ ] Run `npm run validate`.

## Phase 2: Contract and website

- [ ] Change `scripts/publish-data-annotation-contract.ts` to publish every annotation kind's schema and the message records' shape, run `npm run validate`, and publish it with `npx tsx scripts/publish-data-annotation-contract.ts <policeconduct.org>/src/lib/data/annotation-contract.json`.
- [ ] Change the policeconduct.org files listed in the proposal, with the schema check in `annotation-values.js` enforcing `enum`, `pattern` and `format`, and with tests: a template filled with its values as text, a value with markup characters shown as written, a kind with a component, a kind with no component, a public source URL that is not `http` or `https` fails the check, a file source shown with its public URL, and the replacements chosen in open question 2. Run its `npm test` and `scripts/validate-schema-contract.mjs`.

## Phase 3: Rebuild and rollout

- [ ] Write the production migration plan from `design.md`'s Migration Plan and the answers to open questions 1 and 2, with its rollback.
- [ ] Back up the database the rebuild will replace, hold writes to it, and save its annotation IDs and names and its archived evidence.
- [ ] On a clone of the workspace and a database other than production, run the move of the manual annotations and `data reset --no-acquire`.
- [ ] Assert on the rebuilt database: the set of annotation IDs, active and resolved, equals the saved set; every record table with an `id` holds the same IDs as the database being replaced, leaving out `data_mutation_applied` and `build_page_payload`; the archived evidence is kept as open question 1 decides; every annotation's subject exists; every annotation's `message_id` names a `data_annotation_message` row whose `kind` is the annotation's kind; every `binary_file_id` names a `binary_file` row whose bytes exist at its `workspace_path`; every annotation's payload matches its kind's schema; and no annotation row holds an audit reference.
- [ ] Carry out step 6 of the Migration Plan (contract, website, production, workspace, build) and run the checks again against production.
