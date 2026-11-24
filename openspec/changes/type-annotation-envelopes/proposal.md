## Why

An annotation today is a `DataAnnotation` record with one flat `spec`: a type, a field, a value, a plain-text message and an evidence list of untyped records (`src/shared/data-annotations.ts`, `public.data_annotation`). The evidence cannot say where it came from in a form a reader can follow or intake can audit. policeconduct.org prints the message, dumps the evidence as JSON, and reads field names and message text to label, filter and hide annotations. Putting HTML or Markdown in the message would make every producer responsible for escaping source text on a public page.

## What Changes

- **An annotation is typed.** `DataAnnotation` stays the one annotation record. Its row gains a `kind` column naming the annotation kind (what sort of annotation it is) and a payload checked against that kind's schema on every create and update. The first kinds are `general` and `excluded-record`.
- **An annotation carries sources a reader can open.** A source says which sort it is. A public source names what it is and its full URL. A file source points at the file's `BinaryFile` record with a locator (a sheet and row, or a page), and its public part shows the source's own URL.
- **Audit references stay in intake.** Intake's internal audit references are kept only in the transform output and the mutation chain, never in the database.
- **The message is a plain-English template, kept in one place.** An annotation holds a message code and named values. The wording of each code is a `DataAnnotationMessage` record in the chain, written by intake from one checked-in catalogue, so a wording change is a normal `data generate` and `data up`. Anything a reader should be able to open is a source, never markup in the message.
- **`type` and `kind` are distinct.** `type` stays as it is: warning, error or correction. The annotation kind says what sort of annotation it is and selects the schema and the component.
- **policeconduct.org renders by kind.** Intake publishes each kind's schema in its own annotation contract. Record pages show only an annotation's label and message. On the data-annotations listings the website looks up a component for the kind and uses it when one exists; when none exists a default renderer shows the payload as preformatted JSON. What replaces the website's current reading of field names and message text, and the deploy order, is open question 2 in `design.md`.
- **Existing annotations move to the new shape with their IDs kept.** There is one shape; the flat shape is not kept alongside it. How existing rows, recorded chain entries and manual annotations reach the new shape is open question 1 in `design.md`.

## Capabilities

### New Capabilities

- `annotation-envelopes`: The annotation kinds, sources, messages, published schema and website rendering of annotations.

### Modified Capabilities

None in `openspec/specs/` today. These specs describe the flat shape and are reconciled with this change before it is archived:

- In intake, once the changes this one depends on are archived: `record-findings` and `courtlistener-complaint-summaries` (`move-complaint-summaries-to-generate`), and `source-left-out-records` and `oregon-dpsst` (`report-every-left-out-source-record`).
- In intake, the pending change `publish-source-data-annotations`: `source-data-annotations`, `public-data-annotations`, `artifacts-database-import` (the operator's message carried into the annotation), `agency-record-selection`, `intake-date-validation` and `oregon-dpsst`.
- In policeconduct.org: the `public-data-annotations` spec (archived from its own `publish-source-data-annotations` on branch `feat-news-role-reads-secrets`) and the pending change `fix-licensing-authority-annotations`.
- `data-request-document`: the new `DataAnnotationMessage` record type is left out of the Simplified Export Format, as `DataAnnotation` is. `cache-call-results-and-files` also changes that requirement.

## Impact

- **Database:** one Supabase migration: `public.data_annotation` gains `kind`, `payload` (the kind's fields, the message values and the sources), `message_id` and `binary_file_id` and loses `message` and `evidence`, and a new `data_annotation_message` table holds the wordings.
- **Generated files:** `scripts/lib/entity-spec-generator.ts` (the `DataAnnotationMessage` entity, `DataAnnotation`'s new columns and kind check) and `scripts/generate-envelope-types.ts` (which puts `Finding` into every generated artifact IO's record metadata), `npm run generate:envelope-types`, `npm run generate:data-request-doc` (`docs/data-request-format.md`, and `OMITTED_KINDS` in `scripts/lib/data-request-doc-generator.ts`), and the annotation contract `scripts/publish-data-annotation-contract.ts` writes to policeconduct.org's `src/lib/data/annotation-contract.json`.
- **Shared import:** `src/shared/data-annotations.ts` (`Finding` and record `metadata.defects`), `src/shared/inspect-data-annotations.ts` and `src/shared/source-value-types.ts` (validation findings and their messages), `src/shared/io/property-corrections.ts` and `src/shared/io/PropertyCorrection.ts` (correction annotations, the message `cache set --message` records, and any evidence an entry holds), `src/cli/import/artifacts/data-context.ts`, `src/cli/import/artifacts/facades/entity-facade.ts`, `src/cli/import/artifacts/facades/resolver-registry.ts`, `src/cli/import/artifacts/resolver-kit.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/source-transform.ts`, `src/cli/workspace/migrate-state.ts`, and the resolver findings and `complaint_summary_unavailability.detail` in `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts` (ADR 0040).
- **Commands and their help:** `src/cli/data/index.ts` (`data exclude --reason`, published as written) and `src/cli/cache/index.ts` (`cache set --message`).
- **Sources that report findings:** `sources/com/courtlistener/www/api`, `sources/com/site/my/mnitservices/post-license-search`, `sources/gov/texas/tcole`, `sources/net/bpl-orsnapshot/www/public-inquiry-cj`, `sources/net/clearinghouse/api`, `sources/org/policeconduct/submissions`, `sources/org/psvproject/arrest-tracker`, `sources/lib/state-authority-findings.ts`, every source the dependencies add findings to, and the manual source's `DataAnnotation` kind and interview (`sources/org/policeconduct/manual/kinds.ts`, `entity-model.ts`, `acquire.ts`).
- **policeconduct.org:** `src/components/DataAnnotations.astro`, `src/components/RecordDataNotes.astro`, `src/components/DataAnnotationIndex.astro`, `src/components/PersonnelAssignments.astro`, `src/lib/data/data-annotations.ts`, `src/lib/data/annotation-values.js`, `src/lib/data/annotation-views.ts`, `src/lib/data/annotation-contract.json`, `scripts/validate-schema-contract.mjs`, `tests/unit/data-annotations.test.mjs`, `tests/e2e/data-annotations.spec.ts`, the `src/pages/data-annotations/` pages and CSV route, and the `src/pages/[category]/licensing-authority/data-annotations/` pages and CSV route.
- **Rollout:** existing annotations keep their IDs. This needs a production migration plan and a generated type refresh. Whether it needs a data reset, and the order of the intake and website deploys, depend on open questions 1 and 2 in `design.md`.

The design is recorded in ADR 0038, proposed with this change and amended by the owner's answers of 2026-11-20 in `design.md` (decisions 1 to 4). Finding codes and annotation identity are described in ADR 0040.
