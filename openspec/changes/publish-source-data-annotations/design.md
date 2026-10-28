## Context

`src/shared/source-value-types.ts` already produces field/value/reason findings. `src/cli/import/artifacts/data-context.ts` logs them, removes defective records and filters dependents; graph selection can then remove the person. The route audit found five TCOLE people lost this way. The user requests preservation and public accountability, including a licensing-authority view.

## Goals / Non-Goals

**Goals:** Preserve source-reported values and identifiable records; expose our findings beside those values and through downloadable central/provider views. Display calculated negative or unusually long tenure.

**Non-Goals:** Automated provider outreach, manual issue workflows, annotation IDs/history/statuses, new annotation types beyond warning/error/correction, or guesses about correct values.

## Decisions

### Record-owned annotations

Add `data_annotations` as a JSON array, default `[]`, to source-imported entity rows. Use one canonical annotation schema across envelope, mutation, database and site contracts:

```json
{
  "field": "end_date",
  "value": "2024-05-22",
  "type": "error",
  "message": "End date precedes start date.",
  "source_namespace": "gov.tx.tcole",
  "source_record_id": "1741748"
}
```

`value` is the inspected JSON-compatible value for warnings/errors and the original source value for corrections; correction entries additionally require `replacement_value` and carry optional `evidence` when supplied. An invalid unrepresentable literal remains the inspected value via its source evidence. `source_record_id` is the producing record's source-local identity, not necessarily a person ID (an employment annotation uses the employment source key). The owner already supplies canonical identity; no annotation ID is necessary. The namespace identifies the provider; authority labels/links use explicit source-to-authority metadata, never the person's current employer or name matching.

An end-before-start contradiction is an error. Existing duration-over-70-years detection becomes a warning, with wording that identifies our concern without declaring the reported fact false. Future dates likewise warrant a warning rather than automatic exclusion. Scheduled source employment must remain visible with its future date. Thresholds are detection policy, not truth constraints. No new thresholds are introduced.

### Validation scope

The annotation mechanism must support any record type. Each record type may have its own validators, or none. Shared storage and display do not require identical validation across tables. Add validators only where this change specifies a rule; a blanket audit or validation of every date column is not an acceptance requirement.

### Preserve values and update findings

Replace source-defect omission with value/provenance preservation in the shared import pipeline. Warning/error detection runs in the post-mutation stage. Applied corrections are captured during mutation generation, where their use is known. Retain representable values in their existing columns. For a literal unrepresentable by a typed column, keep the exact value in the annotation and allow the affected descriptive field to be empty; display the original value. Do not interpret an unrepresentable source end date stored as null as current employment: shared graph admission and site employment queries must distinguish it from a source-reported empty end date using persisted source evidence, even before annotations have been calculated. An annotation itself is a derived output, not the authority for the source value. Missing canonical identity, broken foreign keys, malformed envelopes and failed writes remain structural failures, not public annotations substituting for record integrity.

After all pending mutations in the command batch succeed, run one explicit annotation stage over the final database records. Recompute only warning/error annotations from effective values after corrections and replace that portion of each array, clearing obsolete warnings/errors while preserving all correction annotations. A correction and a warning/error may coexist on the same field. Do not clear annotations before inspection or recalculate between individual mutations. A failed mutation batch does not start the annotation stage; a failed annotation stage fails the command visibly and must not publish a partially refreshed set. Publish the computed replacements atomically. A no-pending-mutations run can rerun the scan, allowing date-dependent warnings to expire. Source values and provenance are persisted before this stage so findings can be attributed without guessing. Existing raw files remain evidence. This proposal does not rewrite authoritative supplied values or guess corrections; established explicit corrections retain their original source evidence.

### Applied correction annotations

Generated mutations carry `correction` annotations from the existing conditional correction mechanism. Each includes the original `value`, `replacement_value`, explanation in `message`, source namespace/source record ID and optional `evidence` when supplied. Record correction provenance even when the corrected value equals the stored database value; a changed annotation set can require an annotation-only mutation.

Replacement ownership is `(owning entity kind + canonical ID, source_namespace, source_record_id)`, not a field or a namespace alone. The generated mutation payload must identify each processed source contribution and its complete correction set, including an explicit empty set. Apply replaces only correction annotations for that contribution using the current stored array; it must not overwrite other contributions with a stale precomputed whole-record array. Multiple mutations in one run for that contribution carry the run's complete applied-correction set rather than erasing it field by field. Unprocessed source contributions survive. A processed contribution with no applied corrections clears its previous corrections. Merely having an override configured does not produce an annotation; it must actually apply during the run. Current correction annotations describe application during that contribution's latest processed run, not a requirement that its corrected field changed in that run.

This is replacement metadata within canonical generated mutations, not a separate annotation table or independently identified record. Applied correction annotations are committed with the owning mutation. Warning/error recalculation does not reset them, including when the scan fails. A no-pending-mutations scan does not mean every source contribution was processed and must leave corrections untouched.

### Public display and index

The profile shows reported values and calculations as facts attributed to the provider, with a separately labelled “Our warning”, “Data error”, or “Our correction” message. A correction shows original and replacement values, why it was applied, and supporting evidence when supplied; it is attributed to us, with the source identified as the provider of the original value. Negative duration and 125-year duration remain visible. Unparseable dates have no mathematical duration; show the literal date value and finding.

A shared build-time collector emits one index entry per stored annotation, using the owning entity's public display URL (for employment, the personnel profile showing the assignment), label, source and value. Both profile display and index use the stored finding rather than independent detection rules.

Generate `/data-annotations/` with source-provider and type filters. Reuse the site's existing 50-entry page size. Generate finite filter combinations and CSV files at build time; no runtime API. Stable ordering uses source namespace, entity kind, canonical ID, field and type. Each row displays affected person/agency, field, reported value, type, message, provider/source ID and a record link. CSV columns:

`source_provider,source_record_id,record_url,field,reported_value,type,message,replacement_value,evidence`

Downloads contain all matching annotations across pages, not just the visible page. JSON-compatible non-string values have a lossless JSON text representation in the CSV value cell.

### Licensing authority view

Add an annotations link and a paginated `data-annotations/` subpage under each existing licensing-authority profile route, following that site's route conventions. It uses the same collector fixed to the authority's supplying source namespaces, allows type filtering, and downloads the full matching result. Include annotations on any record supplied by that authority, not just licenses or personnel currently employed by an agency. Authorities with no annotations show an explicit empty state. Do not attribute unrelated providers' annotations to an authority merely because a person holds its license.

## Risks / Trade-offs

- Factual defects were previously admission blockers → explicitly change the applicable OpenSpec requirements and exercise graph inclusion with the five actual Texas examples.
- Typed columns cannot contain every literal → retain exact literals in annotations and expose them alongside the field; retain structural integrity checks.
- A null date could falsely mean current employment → derive display/status using the original annotated value when the typed value is unavailable.
- A post-mutation scan could lose source attribution → resolve each inspected value through persisted field/source evidence; never infer the provider from the current employer.
- Static views could disagree → derive central, authority and CSV results from the same collected entries.

## Migration Plan

Add columns/necessary descriptive-field changes through a new migration. Regenerate canonical IO and downstream types. Validate migration, reset and seed assertions in a disposable database. Apply the forward migration to the configured environment through the normal release process; regenerate/apply affected imports from retained sources without resetting production, then rebuild the site. Verify restored IDs/slugs and public annotations. A rollback must not delete restored evidence; retain additive columns if application code is reverted.

## Geography decision

The user resolved geography scope on 2026-10-27: retain existing required geography and routes. An unresolvable record requires an explicit correction or explicit exclusion; do not invent coordinates or introduce nullable geography/new routes. Corrections produce annotations on the corrected record. Exclusions preserve the source key, kind, optional recorded name, and explicit reason on the source's licensing authority, since the excluded record has no page. Authority attribution must use explicit source namespace mapping and fail loudly when exclusion ownership is missing or ambiguous. Reruns replace only that provider's exclusions, including clearing its old findings when the exclusion set becomes empty. The final annotation scan renders those explicit exclusions as warnings, preserving the reason without asserting the source fact is false. Authority subpages follow `/[category]/licensing-authority/data-annotations/`.
