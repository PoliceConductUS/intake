## Context

An annotation is a database record attached to another record. It reports a problem with a source's data. Today:

- **Record.** Every annotation is a `DataAnnotation` record in `public.data_annotation` (`supabase/migrations/20261029000000_native_data_annotations.sql`), carried in `DataAnnotations` artifacts. `DataAnnotationCreate` and `DataAnnotationUpdate` write it and `DataAnnotationRead` reads it. Its spec, `DataAnnotationSpec`, is generated from the table (`scripts/lib/entity-spec-generator.ts`). Its columns are `id`, `subject_kind`, `subject_id`, `producer_namespace`, `producer_record_id`, `source_namespace`, `source_record_id`, `type`, `field`, `value`, `replacement_value`, `message`, `evidence` and `status`.
- **Producers.** `data generate` derives annotations from four groups of findings per record (ADR 0040): source findings in `metadata.defects`, resolver findings, corrections, and validation findings (`src/shared/inspect-data-annotations.ts`, `src/shared/source-value-types.ts`). Only source and resolver findings (`Finding` in `src/shared/data-annotations.ts`) have a `code`; it is used in the annotation's name and is not stored. Validation findings come from the rules `invalid-date`, `future-date`, `invalid-<type>`, `reversed-date-range`, `long-date-range` and `explicit-exclusion`; corrections come from `PropertyCorrection` entries. Operators also write `DataAnnotation` records through the manual source, whose interview is built from `DataAnnotationSpec`'s fields (`sources/org/policeconduct/manual/entity-model.ts`) and whose records are kept in its hash-linked chain of snapshots in state.
- **Messages.** Most messages are built from values of one record: an agency name, a docket address, a start date, a number of years, the validation day of the run, the reason given to `data exclude --reason`, or the message an operator gave `cache set --message`. The exclusion reason and the operator's message are published as written. A `PropertyCorrection` entry may hold no message (the CLI requires one today; older entries may lack it), and then a fixed text is published. The complaint resolver also copies its message into `civil_cases.complaint_summary_unavailability.detail`.
- **Evidence.** `evidence` is a list of untyped records whose keys differ by producer: `{url}`, `{url, file}`, `{url, file, row}`, `{url, reason}`, `{file}`, `{file, row}`, `{file, officer}`, `{file, agency}`, `{file, courseId}`, `{file, case}`, `{workbook, sheet, row}` (a file name in Texas TCOLE, a web address in the PSV arrest tracker), `{what, source_namespace, url}` and `{what, source_namespace, url, retrieved_at, sha256}`.
- **Retained files.** Today only downloads made through the service clients become `BinaryFile` envelopes in the call cache (`src/shared/services/client-base.ts`), and other sources keep their files in command folders. The pending change `cache-call-results-and-files` makes `BinaryFile` an ordinary record kind (owner's ruling, 2026-11-19): a source that keeps a file emits a `BinaryFile` record with the file's SHA-256 as its source name, the `binary_file` row holds `sha256`, `extension`, `content_type`, `byte_count` and `workspace_path`, the bytes are stored on disk by namespace, and a record that has a file points at its `BinaryFile` record with a foreign key.
- **Identity.** `DataContext` (`src/cli/import/artifacts/data-context.ts`) names an annotation with the hex SHA-256 of `JSON.stringify([subject kind, subject identity, ...owner])`, then `/`, then the hex SHA-256 of `JSON.stringify([key, source_namespace, source_record_id])`. The owner is `["source", artifact namespace]`, `["resolver"]`, `["correction", source_namespace, source_record_id]` or `["validation"]`. The key is a JSON string: `JSON.stringify([code, field])` for source and resolver findings, `JSON.stringify(["correction", field])` for corrections, `JSON.stringify(["explicit-exclusion", namespace, kind, key])` for an exclusion, and `JSON.stringify([rule, field])` for the other validation rules. Its ID comes from that name through the source-name mapping under namespace `intake` and kind `DataAnnotation`. Resolution reads the stored `producer_namespace`, `producer_record_id`, `status`, `type` and `field`, and writes the stored row back with `status: resolved`.
- **Website.** policeconduct.org reads `public.data_annotation` with `select *` in `src/lib/data/data-annotations.ts` and `src/components/PersonnelAssignments.astro`. It builds a projection of named fields from each row (`annotationFromRecord`), checks the projection against the annotation contract that `scripts/publish-data-annotation-contract.ts` writes into its repository, and fails the build on a mismatch; the check ignores `enum`, `pattern` and `format`. It reads `field`, `value` and the message text to label annotations, to place them beside a date on a personnel page, to hide the value of an `*_id` field, to reword two messages, to leave the record unlinked for an excluded record, and to leave out excluded personnel when its build variable `NO_PERSONNEL` is set. It routes and filters by `source_namespace` and `type`, and sorts by `source_namespace`, subject, `field`, `type`, `source_record_id` and message. Its CSV has the columns of the flat shape. `scripts/validate-schema-contract.mjs` lists the flat columns.
- **Rebuild.** `data reset` runs `supabase db reset` against the database `DATABASE_URL` names, moves `data/mutations` aside so the chain starts again, and acquires every source again unless given `--no-acquire` (`src/cli/data/README.md`).

## Goals / Non-Goals

**Goals:**

- Give each annotation typed sources a reader can open, and keep intake's audit references out of the database.
- Keep reader-facing wording in one place, as plain text with no markup.
- Let the website render an annotation by its kind without knowing what a finding code or field means.
- Keep every annotation's ID.

**Non-Goals:**

- Changing which records get annotations, or the rules that produce findings.
- Changing `type` or its values.
- Changing how an annotation is resolved when its finding is no longer reported.

## Decisions

The decisions of ADR 0038 apply, as amended here (owner's answers, 2026-11-20).

1. **IDs do not move.** `DataContext` names an annotation as described under Identity, and its ID is resolved under namespace `intake` and kind `DataAnnotation`. A manual annotation keeps the ID it has. Any choice that changes either is ruled out.
2. **One `DataAnnotation` record with an annotation kind and a typed payload** (amends ADR 0038 decision 1). `DataAnnotation` stays the only annotation record and mutation kind. `public.data_annotation` gains a `kind` column naming the annotation kind (what sort of annotation it is) and a `payload` column checked against that kind's schema. The first kinds are `general` and `excluded-record`; a kind is added when a component or rule needs it. Every write checks the whole resulting record against its kind's schema: a create, and an update or PATCH after it is applied, since `DataAnnotationUpdate` and PATCH records otherwise check one field at a time and skip the descriptor's `superRefine`. The columns kept are `id`, `subject_kind`, `subject_id`, `producer_namespace`, `producer_record_id`, `source_namespace`, `source_record_id`, `type`, `field`, `value`, `replacement_value` and `status`, so naming, resolution and the website's routing, filtering and sorting keep their inputs. `message` and `evidence` are replaced by `message_id`, the payload (the kind's fields, the message values and the sources) and `binary_file_id`, as decisions 3 and 4 describe.
3. **Messages are templates with named values, kept as a record kind in the chain** (amends ADR 0038 decision 4). An annotation holds a message code and the named values its template uses. The wordings are `DataAnnotationMessage` records (the record kind for one message code's wording) in a new `data_annotation_message` table: `id`, `code` (the business key), `kind` (the annotation kind the message belongs to) and `template`. A template names its values as `{name}` placeholders, and the website fills them in as text, so no value is read as markup. The wordings are written by intake in one checked-in catalogue. The shared import writes them: in every `data generate`, `DataContext` emits the `DataAnnotationMessage` record of each message code its annotations use, under namespace `intake` with the code as its source name, before those annotations, in the same mutation. The annotation's `message_id` column is then a same-run foreign key to that record under namespace `intake`, which the standard resolver chain already finds, so no source has to run first, and the manual source's annotations get their messages the same way. Compare, then write keeps an unchanged wording a no-op; a changed wording is one update in the next generate, and the annotations that use it do not change. A `data generate` fails when a template names a value its annotation lacks, when an annotation holds a value its template does not name, or when a code is not in the catalogue.
   - **Message codes.** Source and resolver findings use their `code` (ADR 0040 keeps it when the wording changes). Validation findings use their rule name (`invalid-date`, `future-date`, `invalid-<type>`, `reversed-date-range`, `long-date-range`, `explicit-exclusion`). Corrections use `correction`, with the operator's message as a value when the entry has one, and `correction-without-message` when it has none. A manual annotation names a code from the catalogue.
   - **No value depends on the run.** The validation day and other values that change from run to run are not message values, so an unchanged finding writes nothing.
   - `complaint_summary_unavailability.detail` holds the message code.
4. **Sources.** An annotation's payload holds a list of sources, each stating which sort it is.
   - A **public source** names something a reader can open: what it is and its full `http` or `https` URL.
   - A **file source** points at the file's `BinaryFile` record and a locator of the part it means (a sheet and row, a page, a record's key), and its public part is the source's own URL where it has one (amends ADR 0038 decision 2). The file is stored and referenced as `cache-call-results-and-files` sets for every record that has a file: the producer emits the `BinaryFile` record, and the annotation's `binary_file_id` column is a foreign key to it, resolved by the standard foreign-key resolver. An annotation has at most one file source; no finding has more today. The file's SHA-256 is on its `BinaryFile` record, and no retrieval time is stored on the annotation, since a refreshed call would change it.
   - Every locator today's evidence holds has a place, so provenance is not reduced.
5. **Audit references stay out of the database** (amends ADR 0038 decision 3). Intake's internal audit references (the command, a workspace path, a source ID) are kept only in the transform output and in the chain entry beside the annotation's mutation. The `data_annotation` row, the published contract and the website never hold them.
6. **Sources do not change when findings do not.** No source or value takes anything from the time of the run, so a `data generate` with unchanged findings writes no annotation (AGENTS.md "Compare, then write").
7. **Record pages show only the label and the message.** Rendering by kind, and the default rendering, are used on the data-annotations listings, including those of a licensing authority. The policeconduct.org change `fix-licensing-authority-annotations` makes this change to record pages.
8. **The contract is this change's own.** `scripts/publish-data-annotation-contract.ts` publishes every annotation kind's schema and the message records' shape to policeconduct.org. `publish:import-schemas` is removed by `keep-state-under-one-root` (owner's ruling, 2026-11-18) and is not used.

**Parts of the spec are provisional.** The ID scenarios follow the recommendation for open question 1, and the label and default rendering follow open question 2. They are rewritten when those questions are answered.

## Alternatives Considered

- **HTML or Markdown in the message.** Rejected in ADR 0038: every producer would have to escape quoted source text on a public page.
- **A fixed message per code with typed fields, or per-annotation text with no messages.** Rejected by the owner (2026-11-20) for templates with named values.
- **The wordings in a migration or in the published contract.** Rejected by the owner (2026-11-20): the wordings are a record kind in the chain, so a wording change is a normal `data generate` and `data up`.
- **One envelope kind per annotation kind, or no kinds.** Rejected by the owner (2026-11-20) for one `DataAnnotation` record with a kind column.
- **Audit references in the database, in the payload or a table of their own.** Rejected by the owner (2026-11-20): `public` tables have no grants or row level security, so any reader of a published database could read them.

## Open Questions

These two need the owner's decision before implementation.

1. **How existing annotations reach the new shape.** The existing rows, the recorded chain entries (`DataAnnotationCreate` and `DataAnnotationUpdate` in the flat shape, which strict IO rejects after the change) and the manual source's `DataAnnotation` records hold no kind, message code or values, and nothing a file source needs. `PropertyCorrection` entries need no move: their message becomes a value, and a search of the dev and prod workspaces on 2026-11-18 found none holding evidence.
   - (a) The migration changes the schema only and fails if `public.data_annotation` holds a row (amends ADR 0038 decision 6). A one-time script on a clone of the workspace appends a new head snapshot to the manual chain with its annotations in the new shape, keeping history. `data reset --no-acquire` then rebuilds a database other than production, and the chain starts again (ADR 0033's revisit trigger); the owner already plans a `data reset --no-acquire` when `keep-state-under-one-root` lands (ruling, 2026-11-18), and one reset can serve both. Three things then need the owner: `public.legacy_data_annotation_evidence`, which a rebuild leaves empty (copy its production rows, keep them as a file in the workspace, or let them go); the annotations a rebuild cannot make again even with today's code (resolved `future-date` annotations depend on the run's day, corrections removed by `cache unset` are not made again, pruned acquisitions are skipped); and how the rebuilt database replaces production, which this repository does not describe.
   - (b) A one-time script rewrites the recorded chain entries and the manual records in place. It must derive message codes and values from today's message text, which holds no code.
   - (c) A migration rewrites the rows in SQL. It writes data outside the mutation chain, cannot derive codes or values, and the chain no longer replays.

   Recommendation: (a), run as the same `data reset --no-acquire` the owner plans after `keep-state-under-one-root`, with the archived evidence copied into the rebuilt database and a rebuild with today's code compared first, so differences that exist already are settled before this change.

2. **What replaces the website's reading of field names and message text, and the deploy order.** The website labels an annotation from `type`, `field` and a regular expression on the message, hides excluded personnel when `NO_PERSONNEL` is set by reading `field` and `value.kind`, hides `*_id` values, rewords two messages, and exports a CSV of the flat columns. It checks each row's projection against its copy of the contract and fails the build on a mismatch, so a database in the new shape fails today's website build.
   - (a) The label is a column of the message record. The `excluded-record` kind's typed fields drive the record link and the `NO_PERSONNEL` filter. A personnel page keeps placing an annotation beside a date by `field`, which stays a column. The default rendering leaves out canonical IDs. The CSV keeps `source_provider`, `source_record_id` and `record_url` and replaces the flat columns with kind, type, message and sources. The website checks the common fields of every row, enforces `enum`, `pattern` and `format`, and checks the payload only for kinds in its copy of the contract. Deploy: publish the contract and merge the website change with website builds held, publish the database, then build.
   - (b) As (a), with no release order: the website change only has to make the next website build work, as the owner ruled for `personnel_photo` (2026-11-19).
   - (c) The website accepts both shapes for one release. This conflicts with "no backward compatibility".

   Recommendation: (b).

## Migration Plan

Assuming the recommendations:

1. The changes in the tasks' "Depends on" are archived, and a rebuild with today's code matches the database it would replace (open question 1).
2. Back up the database the rebuild will replace, hold writes to it, and save its annotation IDs and names and its archived evidence.
3. Hold changes to the original workspace, and clone it. Run the one-time script against the clone to append the manual annotations in the new shape.
4. Point `DATABASE_URL` at a database that is not production and run `data reset --no-acquire` with the clone as the workspace.
5. Run the checks in the tasks.
6. Publish the contract, merge the website change, replace production with the rebuilt database, make the clone the workspace, build the website, and run the checks again against production.

Rollback: restore the backed-up database, the website, the intake code and the original workspace together.

## Risks / Trade-offs

- **A database and website in different shapes fail the website build** → open question 2 settles the order.
- **Annotation IDs could change** → decision 1, and the ID set check against the database being replaced.
- **An audit reference could reach the database or a page** → decision 5 keeps them out of the database, so no website path can show one.
- **Sources or values that change every run would rewrite annotations and grow the chain** → decision 6.
- **A new kind's fields are published without a site change by the default rendering** → a kind's schema holds only fields meant for readers, and the default rendering leaves out canonical IDs.
- **A changed wording changes many pages at once** → it is one reviewed change to the checked-in catalogue, written as one record update.
- **The migration applied to a database that still holds flat rows** → under open question 1(a) the migration fails on any annotation row.
- **The rebuild loses evidence or IDs the replaced database holds** → open question 1 settles the archived evidence and the baseline before the rebuild, and the backup allows rollback.
- **Pending changes add flat-shape findings** → they land first, and this change moves what they add.
