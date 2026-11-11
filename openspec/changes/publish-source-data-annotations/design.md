# Native source data annotations

## Record contract

Store findings in public.data_annotation. Each has a canonical ledger-assigned id, subject_kind and subject_id, producer_namespace and producer_record_id, source_namespace and source_record_id, type (warning/error/correction), field, JSON value, message, optional replacement_value and evidence, and status (active/resolved). Subject references use the shared reference resolver and reject unknown kinds or missing subjects. Any ordinary record kind can be a subject.

## Intake integration

The shared schema introspector generates DataAnnotationSpec, DataAnnotation singular IO, DataAnnotations plural Artifacts IO, and ordinary create/update/read mutation IO. The registry and generic facade handle these records; the existing manual source acquires DataAnnotation records into its normal saved chain and transforms that chain into DataAnnotations artifacts. Source producers can emit the same records in Artifacts. Root intake produces its own findings during normal generation. No special refresh command, standalone annotation apply path, or post-apply scan exists.

Root findings use the intake producer namespace and stable source-local names scoped by subject and source contribution. The durable source-name mapping ledger assigns canonical IDs. Generation inspects effective values after corrections and current-row merging. Obsolete root-generated findings become ordinary status=resolved updates. Manual/source-produced rows and unprocessed source contributions remain intact. Corrections preserve original value, replacement, explanation, and supplied evidence. Exclusion findings link to the explicitly mapped licensing authority and retain excluded-record identities and reasons.

Up and replay only apply generated mutations. Shared JSON-column metadata handles JSON scalars, arrays, objects, and null without annotation-specific apply code. Raw data_source_values remains on subject rows; source_exclusions retains explicit exclusion evidence. Neither is a second live annotation model.

## Migration and downstream contract

Forward migration 20261029000000_native_data_annotations.sql archives historical arrays in public.legacy_data_annotation_evidence, creates the native table, then drops obsolete arrays. The archive is audit evidence only and is not published. Existing installations regenerate native findings through normal source generation/update. No shared database reset is authorized by this change. Canonical generated contracts are refreshed against disposable migrated PostgreSQL. The downstream publisher exports the existing payload schema, the native row schema, source evidence schema, and subject table descriptors. The site selects active native records and resolves their canonical subjects.

## Verification

Tests exercise singular/plural IO, manual and source records, stable IDs across reruns, obsolete finding resolution, independent producers, JSON evidence, subject integrity, native generate/apply/replay, and retained factual defects. Full intake validation, OpenSpec validation, SQL checks, and disposable migration/reset checks are required before completion.
