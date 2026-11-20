## Context

An annotation is a database record attached to another record. It reports a problem with a source's data. Today:

- **Record.** Every annotation is a `DataAnnotation` record in `public.data_annotation` (`supabase/migrations/20261029000000_native_data_annotations.sql`), carried in `DataAnnotations` artifacts. `DataAnnotationCreate` and `DataAnnotationUpdate` write it and `DataAnnotationRead` reads it. Its spec, `DataAnnotationSpec`, is generated from the table (`scripts/lib/entity-spec-generator.ts`). Its columns are `id`, `subject_kind`, `subject_id`, `producer_namespace`, `producer_record_id`, `source_namespace`, `source_record_id`, `type`, `field`, `value`, `replacement_value`, `message`, `evidence` and `status`.
- **Producers.** `data generate` derives annotations from four groups of findings per record (ADR 0040): source findings in `metadata.defects`, resolver findings, corrections, and validation findings (`src/shared/inspect-data-annotations.ts`, `src/shared/source-value-types.ts`). Only source and resolver findings (`Finding` in `src/shared/data-annotations.ts`) have a `code`; it is used in the annotation's name and is not stored. Validation findings come from the rules `invalid-date`, `future-date`, `invalid-<type>`, `reversed-date-range`, `long-date-range` and `explicit-exclusion`; corrections come from `PropertyCorrection` entries. Operators also write `DataAnnotation` records through the manual source, whose interview is built from `DataAnnotationSpec`'s fields (`sources/org/policeconduct/manual/entity-model.ts`) and whose records are kept in its hash-linked chain of snapshots in state.
- **Messages.** Most messages are built from values of one record: an agency name, a docket address, a start date, a number of years, the validation day of the run, the reason given to `data exclude --reason`, or the message an operator gave `cache set --message`. The exclusion reason and the operator's message are published as written. A `PropertyCorrection` entry may hold no message (the CLI requires one today; older entries may lack it), and then a fixed text is published. The complaint resolver also copies its message into `civil_cases.complaint_summary_unavailability.detail`.
- **Evidence.** `evidence` is a list of untyped records whose keys differ by producer: `{url}`, `{url, file}`, `{url, file, row}`, `{url, reason}`, `{file}`, `{file, row}`, `{file, officer}`, `{file, agency}`, `{file, courseId}`, `{file, case}`, `{workbook, sheet, row}` (a file name in Texas TCOLE, a web address in the PSV arrest tracker), `{what, source_namespace, url}` and `{what, source_namespace, url, retrieved_at, sha256}`.
- **Retained files.** Only downloads made through the service clients become `BinaryFile`s in the call cache (`src/shared/services/client-base.ts`); today that is the complaint resolver's downloads. A second write of the same bytes keeps the first envelope, so `BinaryFile.origin` holds the first address and time those bytes were fetched from. The Minnesota POST, Oregon DPSST, Census and Wikipedia acquires download outside the cache (`cache-every-acquire` moves them onto it), and other sources keep their files in command folders. The pending change `cache-call-results-and-files` makes `BinaryFile` a record kind with a `binary_file` table that other records point at with a foreign key, storing no path.
- **Identity.** `DataContext` (`src/cli/import/artifacts/data-context.ts`) names an annotation with the hex SHA-256 of `JSON.stringify([subject kind, subject identity, ...owner])`, then `/`, then the hex SHA-256 of `JSON.stringify([key, source_namespace, source_record_id])`. The owner is `["source", artifact namespace]`, `["resolver"]`, `["correction", source_namespace, source_record_id]` or `["validation"]`. The key is a JSON string: `JSON.stringify([code, field])` for source and resolver findings, `JSON.stringify(["correction", field])` for corrections, `JSON.stringify(["explicit-exclusion", namespace, kind, key])` for an exclusion, and `JSON.stringify([rule, field])` for the other validation rules. Its ID comes from that name through the source-name mapping under namespace `intake` and kind `DataAnnotation`. Resolution reads the stored `producer_namespace`, `producer_record_id`, `status`, `type` and `field`, and writes the stored row back with `status: resolved`.
- **Website.** policeconduct.org reads `public.data_annotation` with `select *` in `src/lib/data/data-annotations.ts` and `src/components/PersonnelAssignments.astro`. It builds a projection of named fields from each row (`annotationFromRecord`), checks the projection against the annotation contract that `scripts/publish-data-annotation-contract.ts` writes into its repository, and fails the build on a mismatch; the check ignores `enum`, `pattern` and `format`. It reads `field`, `value` and the message text to label annotations, to place them beside a date on a personnel page, to hide the value of an `*_id` field, to reword two messages, to leave the record unlinked for an excluded record, and to leave out excluded personnel when its build variable `NO_PERSONNEL` is set. It routes and filters by `source_namespace` and `type`, and sorts by `source_namespace`, subject, `field`, `type`, `source_record_id` and message. Its CSV has the columns of the flat shape. `scripts/validate-schema-contract.mjs` lists the flat columns.
- **Rebuild.** `data reset` runs `supabase db reset` against the database `DATABASE_URL` names, moves `data/mutations` aside so the chain starts again, and acquires every source again unless given `--no-acquire` (`src/cli/data/README.md`).

## Goals / Non-Goals

**Goals:**

- Give each annotation typed sources: public sources a reader can open, and intake references for audit.
- Keep reader-facing wording in one place, as plain text with no markup.
- Let the website render an annotation by its kind without knowing what a finding code or field means.
- Keep every annotation's ID.

**Non-Goals:**

- Changing which records get annotations, or the rules that produce findings.
- Changing `type` or its values.
- Changing how an annotation is resolved when its finding is no longer reported.

## Decisions

The decisions of ADR 0038 apply. In addition:

1. **IDs do not move.** `DataContext` names an annotation as described under Identity, and its ID is resolved under namespace `intake` and kind `DataAnnotation`. A manual annotation keeps the ID it has. Any choice below that changes either is ruled out.
2. **Intake references are never published.** No page, default rendering or CSV of policeconduct.org shows an intake reference. Each source states whether it is a public source or an intake reference.
3. **Record pages show only the label and the message.** Rendering by kind, and the default rendering, are used on the data-annotations listings, including those of a licensing authority. The policeconduct.org change `fix-licensing-authority-annotations` makes this change to record pages.
4. **Provenance is not reduced.** An intake reference can point at part of a file (a sheet, a row, a page, a record's key), so every locator today's evidence holds has a place.
5. **Sources do not change when findings do not.** An intake reference names no per-run command or folder, and a source takes no value from the time of the run, so a `data generate` with unchanged findings writes no annotation (AGENTS.md "Compare, then write"). The first draft's `commandId` and `command-folder` path conflict with this and are settled in question 4, with the retrieval time a public source carries.

**Parts of the spec are provisional.** These parts are rewritten when their question is answered: "An annotation is a typed envelope" (question 3), "The message is plain English kept in one place" (question 1), where an annotation's sources are kept (question 6), the ID scenarios, which follow the recommendation for question 2, and the label and default rendering (question 5).

## Alternatives Considered

- **HTML or Markdown in the message.** Rejected in ADR 0038: every producer would have to escape quoted source text on a public page.
- **Typed sources on the flat record, with one generic renderer.** Kept open as question 3(c).
- **Per-annotation message text with no messages table.** Kept open as question 1(c).
- **Wording shipped in the annotation contract.** Kept open as question 1(iii).

## Open Questions

These need the owner's decision before implementation. Each gives the options and a recommendation. An option marked "changes ADR 0038" changes a decision the ADR states.

1. **How a message carries values that differ per annotation, and where the wording lives.** Today almost every message holds values from one record, and the exclusion reason and an operator's message are published as written. A value that changes on every run, such as the validation day, would rewrite the annotation on every run (decision 5).
   - (a) A message is a template with named parameters. The annotation holds the parameter values, and the website fills them in as text.
   - (b) A message is fixed for its code. Values that differ per annotation are typed fields of the kind, which the kind's component shows.
   - (c) Each annotation keeps its own message text and there is no messages table (changes ADR 0038 decision 4). Rewording a code then writes one update per annotation into the chain.

   The wording lives in one of these places:
   - (i) A table written by a migration with checked-in IDs. This puts data into the database outside the mutation chain, and each wording change is a migration.
   - (ii) A table written through the mutation chain as a record kind with a cuid2 ID and the message code as its business key. The generator makes the annotation's reference a foreign key that resolves to the message's ID, adds the kind to the contract's `records`, and makes it a possible annotation subject; the accepted `data-request-document` spec changes, and a named producer writes the messages. That producer must run before every source, since every source's `data generate` makes annotations; derived run order does not place it there today, and `data reset` runs the manual source last.
   - (iii) The annotation contract that intake already publishes to the website, beside the kinds' schemas; the row keeps only its code (changes ADR 0038 decision 4). A wording change ships with a contract publish and a site build.

   The answer also gives a message code to every finding group: source and resolver findings have a `code`; validation findings, corrections and manual annotations do not.

   Recommendation: (a) with (ii). The message code is the finding `code`, which ADR 0040 keeps the same when the wording changes; validation findings use their rule name; corrections use `correction`, with the operator's message as a parameter when there is one; a manual annotation names a code from the table. No wording holds a value that changes on every run. `complaint_summary_unavailability.detail` holds the message code.

2. **How existing annotations reach the new shape.** The rows hold no finding code and nothing an intake reference needs. A rebuild applies the migrations and then the recorded chain (ADR 0033), whose entries are in the flat shape. Two stores of workspace state are re-read, not regenerated: `PropertyCorrection` entries and the manual source's `DataAnnotation` records in its hash-linked chain, which a move extends with a new head snapshot, keeping its history, as `workspace migrate-state` does. `cache set` writes no evidence, and a search of the dev and prod workspaces on 2026-11-18 found no `PropertyCorrection` entry holding any, so under the recommendation for question 1 those entries may need no move.
   - (a) A migration rewrites the rows, as first written. It cannot derive codes or sources, it writes data outside the mutation chain, and the chain no longer replays.
   - (b) The migration changes the schema only, and fails if `public.data_annotation` holds a row, so it cannot be applied in place (changes ADR 0038 decision 6). The manual `DataAnnotation` records, and any `PropertyCorrection` entry the new shape cannot read, are moved in a clone of the workspace, either by a one-time script (owner's ruling on workspace moves) or by the existing `workspace migrate-state` command (AGENTS.md wants correction changes made through the CLI). `data reset --no-acquire` then rebuilds a database other than production from the retained acquisitions; the chain starts again, which is the case ADR 0033's revisit trigger names. How the rebuilt database replaces production is not described in this repository; the owner names that step.
   - (c) A one-time script also rewrites the recorded chain entries (changes ADR 0038 decision 6). It has the same missing data as (a).

   Under (b) the answer also settles three things:
   - **The archived evidence.** `public.legacy_data_annotation_evidence` is filled only by the 20261029 migration from columns it then drops, so a rebuilt database has it empty. Its production rows are either copied into the rebuilt database, kept as a retained file in the workspace, or knowingly let go.
   - **What a rebuild can reproduce.** Even with today's code, a rebuild does not reproduce every annotation of the database it replaces: a resolved `future-date` annotation depends on the run's validation day, a correction removed by `cache unset` is not made again, pruned acquisition outputs are skipped, and failed calls past their retry time are made again. AGENTS.md treats any lost or changed ID as a defect. Recommendation: before this change, rebuild with today's code and compare with the database it would replace, so differences that exist already are found and settled first.
   - **What the check compares.** The set of annotation IDs, active and resolved, and the IDs of every record table that has an `id`; `data_mutation_applied` (the chain starts again) and `build_page_payload` (the website fills it) are left out.

   Recommendation: (b), with a one-time script, and the archived evidence copied into the rebuilt database. It needs a data reset.

3. **How annotation kinds fit the `DataAnnotation` record.** The generator maps one record kind to one table, and one spec serves the plural, singular and mutation envelopes.
   - (a) `DataAnnotation` stays the envelope, record and mutation kind (changes ADR 0038 decision 1). A new column names the annotation's kind, and a typed payload column is checked against that kind's schema, plugged in through the generator's `override` and the descriptor's `superRefine`. `DataAnnotationUpdate` and PATCH records check one field at a time and skip `superRefine`, so the match between kind and payload is also enforced on updates, by a resolver or a database constraint.
   - (b) Each annotation kind is its own top-level envelope and mutation kind, all stored in `public.data_annotation`, with every one resolving its ID under the mapping kind `DataAnnotation` (decision 1). The generator, `OMITTED_KINDS` in `scripts/lib/data-request-doc-generator.ts`, `workspace migrate-state` and the manual source's one-artifact-kind-per-record-kind rule must change.
   - (c) No annotation kinds: typed sources on the existing record and one generic renderer (changes ADR 0038 decisions 1 and 5). A kind is added when an annotation needs its own fields or layout; the excluded-record annotation would be the first.

   The answer also states the row's columns, which include the inputs of decision 1, what resolution reads, and what the website routes, filters and sorts by. It says how an operator writes a new manual annotation, since the interview takes each answer as text.

   Recommendation: (a). Keep `subject_kind`, `subject_id`, `producer_namespace`, `producer_record_id`, `source_namespace`, `source_record_id`, `type`, `field`, `value`, `replacement_value` and `status`; replace `message` with the message reference and `evidence` with the payload. Start with the kinds that have a consumer, a generic kind and the excluded-record kind, and add a kind when a component or rule needs it. Each message belongs to one kind, and a check asserts that an annotation's kind is its message's kind.

4. **The fields of a source.** The public source has no field names yet. The first draft's intake reference names a command and a `command-folder` or `state-folder` path; a run-specific command breaks decision 5, `state-folder` has no fixed root, and `keep-state-under-one-root` moves state. The owner's ruling is that binary files go into the cache and are referenced where used.
   - (a) Base and relative path, as first written, with `state-folder` meaning the workspace `state/` folder and the command being the acquire that retained the material. Then this change depends on `keep-state-under-one-root`.
   - (b) A retained file is referenced as its cache `BinaryFile` (namespace and SHA-256) and a locator. Base and path are kept for material that is not in the cache (changes ADR 0038 decision 2).
   - (c) Every intake reference is a foreign key to its `binary_file` record and a locator, as `cache-call-results-and-files` sets for every record that has a file (changes ADR 0038 decision 2). This needs that change and `cache-every-acquire`. `cache-every-acquire` moves only the Census, Oregon DPSST, Minnesota POST and Wikipedia acquires; the Texas TCOLE workbook, Clearinghouse, PSV arrest tracker and submissions files need another change, and a local file needs an origin `BinaryFile` does not have.

   A public source's retrieval time is either the recorded call outcome's, which changes each time the call is refreshed (every 120 days for docket entries, every 7 days under `cache-every-acquire`) and then rewrites the annotation, or `BinaryFile.origin`'s, which does not change but is the first fetch of those bytes, possibly from another address. The answer also defines the locator, and how each producer's evidence form above maps to sources; transforms receive no acquire command ID or file digests today.

   Recommendation: (b) now, moving to (c) when every source's files are in the cache; the retrieval time from `BinaryFile.origin`.

5. **What replaces the website's reading of field names, and the deploy order.**
   - (a) The label comes from the messages (one per code). The excluded-record annotation is its own kind; its component, the record link rule and the `NO_PERSONNEL` filter read that kind's typed field for the excluded record (its subject is the licensing authority, so the subject cannot be used). A personnel page keeps placing an annotation beside a date by `field`, which stays a column. The default rendering leaves out values that are canonical IDs. The CSV keeps `source_provider`, `source_record_id` and `record_url` and replaces the flat columns with kind, type, message and public sources. The website checks the common fields of every row, enforces `enum`, `pattern` and `format`, and checks the payload only for kinds in its copy of the contract. The website query and `validate-schema-contract.mjs` include the messages. Deploy order: publish the contract and merge the website change with website builds held, publish the rebuilt database, then build. Rollback restores the previous database, website and intake code together.
   - (b) The website accepts both shapes for one release. This conflicts with "no backward compatibility".

   The answer also fixes the contract's layout and how the website finds a kind's component.

   Recommendation: (a).

6. **Where intake references are stored.** The website reads every column of `public.data_annotation`, and decision 2 covers pages and the CSV but not other readers of a published database.
   - (a) In the payload, in a `sources` field every kind has. Every website path must drop intake references.
   - (b) In a table the website never reads. It is in the `public` schema with no grants or row level security, like `public.legacy_data_annotation_evidence`, so any reader of the published database can read it. It is a record kind written through the chain, with the same consequences as question 1(ii), and needs integrity checks that each row's annotation exists.
   - (c) Only in intake's workspace: the `DataAnnotations` artifacts and the chain entries keep the intake references, and the database row holds only public sources. Nothing new enters the database, and decision 2 holds by construction.

   Recommendation: (c).

## Migration Plan

Assuming the recommendations:

1. The changes in the tasks' "Depends on" are archived, and a rebuild with today's code matches the database it would replace (question 2).
2. Back up the database the rebuild will replace, hold writes to it, and save its annotation IDs and names and its archived evidence.
3. Hold changes to the original workspace, and clone it. Run the one-time script against the clone to move the manual `DataAnnotation` records and any `PropertyCorrection` entry the new shape cannot read.
4. Point `DATABASE_URL` at a database that is not production and run `data reset --no-acquire` with the clone as the workspace.
5. Run the checks in the tasks.
6. Publish the contract, merge the website change with website builds held, replace production with the rebuilt database, make the clone the workspace, build the website, and run the checks again against production.

Rollback: restore the backed-up database, the website, the intake code and the original workspace together.

## Risks / Trade-offs

- **A database and website in different shapes fail every website build** → the deploy order in question 5 holds website builds until both are in the new shape.
- **Annotation IDs could change** → decision 1, and the ID set check against the database being replaced.
- **An intake reference could reach a page, a CSV or another reader of the published database** → decision 2, and question 6(c) keeps intake references out of the database.
- **Sources that change every run or every refresh would rewrite annotations and grow the chain** → decision 5, and the retrieval time chosen in question 4.
- **The rebuild loses evidence or IDs the replaced database holds** → question 2 settles the archived evidence and the baseline before the rebuild, and the backup in step 2 allows rollback.
- **A new kind's fields are published without a site change by the default rendering** → a kind's schema holds only fields meant for readers, and the default rendering leaves out intake references and canonical IDs.
- **The migration applied to a database that still holds flat rows** → under question 2(b) the migration fails on any annotation row.
- **A `data reset` takes time and can stop on a failed snapshot** → it runs with `--no-acquire` on a database other than production, so production stays in place until the checks pass.
- **Pending changes add flat-shape findings** → they land first, and this change moves what they add.
