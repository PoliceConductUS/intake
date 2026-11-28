# shared

## Overview

Code used by more than one part of `intake`: the CLI commands, the sources,
and the import pipeline. The files directly in this directory are value
rules that apply to every entity kind and source namespace: the source
namespace pattern, timestamp and license-type normalization, agency address
and location-path checks, data annotation schemas and the inspection that
produces annotations, the AI complaint summary schema, and jsonb-aware value
equality. Envelope IO lives in [`./io/`](./io/README.md), the command
registration contract in [`./cli/`](./cli/README.md) and the clients for
outside services in [`./services/`](./services/README.md).

## Interface

Source namespaces and text:

- `source-namespace.ts:sourceNamespacePattern` is the regular expression a
  source namespace must match.
- `source-namespace.ts:assertValidSourceId(sourceId)` throws when the id does
  not match it.
- `text.ts:normalizeTextWhitespace(value)` trims and collapses whitespace
  runs to one space.
- `license.ts:canonicalLicenseType(rawType)` normalizes whitespace and drops
  a trailing " License" in any letter case (`/\s+license$/i`).

Timestamps and equality:

- `timestamp-schema.ts:timestampWithTimezone` is the zod schema for a
  timestamp string with an explicit timezone.
- `timestamp-value.ts:timestampValue(kind, field, value)` returns a
  second-precision UTC ISO string for a field listed in the generated
  `TIMESTAMP_PROPERTIES` of that kind, and returns any other value unchanged.
  The value of a listed field may be a string or a `Date`.
- `values-equal.ts:valuesEqual(a, b)` compares primitives with `Object.is`
  and objects and arrays by value, independent of key order.

Agency rules:

- `agency-address-schema.ts:agencyAddressText` and
  `agency-address-schema.ts:agencyZipCode` are zod schemas for agency address
  text and ZIP codes.
- `agency-location-path.ts:requireAgencyPlaceLocationPath(agencyId,
locationPathId, getLocationPathById)` throws unless the id resolves to an
  existing `location_path` whose level is `place`.
  `agency-location-path.ts:AgencyLocationPathLookup` is the lookup's type.

Source value checks and data annotations:

- `source-field-types.ts:sourceValueType(field)` classifies a field name as
  `phone`, `email`, `url`, or `undefined`;
  `source-field-types.ts:ValueType` is that union.
- `source-value-types.ts:cleanSourceValues(kind, input, validationDate)`
  returns the input as `spec` plus the
  `source-value-types.ts:SourceValueDefect` list found in it:
  - `invalid-phone`, `invalid-email`, and `invalid-url`, each an `error`, for
    a field that `sourceValueType` classifies. A value that is not a string
    is a defect, and so is `null` in a field whose spec does not accept
    `null`. An undefined value, and `null` in a nullable field, are not
    checked. An email field may hold several addresses separated by `;` or
    `,`.
  - `future-date`, a `warning`, for a field named `date`, `date_*`, or
    `*_date` whose date is after the day of `validationDate`.
  - The defects of `dateRangeDefects`.
- `source-value-types.ts:dateRangeDefects(spec)` reports an `end_date` before
  `start_date` as an error and a range over
  `source-value-types.ts:MAX_RANGE_YEARS` (70) as a warning.
- `data-annotations.ts:DataAnnotation` is the zod union of `warning`,
  `error`, and `correction` annotations;
  `data-annotations.ts:CorrectionAnnotation` is the `correction` member.
- `data-annotations.ts:CorrectionReplacement`,
  `data-annotations.ts:SourceFieldEvidence`,
  `data-annotations.ts:SourceValues`, and
  `data-annotations.ts:SourceContribution` are the schemas for one source's
  corrections and per-field evidence (`value`, `effective_value`,
  `source_namespace`, `source_record_id`).
- `data-annotations.ts:SourceExclusions` is the schema for exclusions grouped
  by source namespace;
  `data-annotations.ts:replaceSourceExclusions(current, incoming)` merges two
  of them, with an incoming namespace replacing the current one. It parses
  both arguments with `SourceExclusions`.
- `inspect-data-annotations.ts:inspectDataAnnotationFindings(kind, values,
sourceValues, validationDate)` returns keyed annotations for explicit
  exclusions on a `LicensingAuthority`, invalid dates, and every defect from
  `cleanSourceValues`. An invalid-date annotation is returned for a field
  that passes `isDateField` or is listed in the generated `DATE_PROPERTIES`
  of the kind, and only when the stored value is `null`, the source
  `effective_value` is not `null`, and that value fails `representableDate`;
  `inspect-data-annotations.ts:inspectDataAnnotations` returns the
  annotations without keys.
- `inspect-data-annotations.ts:isDateField(field)`,
  `inspect-data-annotations.ts:representableDate(value)`, and
  `inspect-data-annotations.ts:reportedFieldValue(stored, evidence)` are the
  date-field test, the `YYYY-MM-DD` calendar-date test, and the choice of the
  effective source value when the stored value is null.

AI complaint summaries and release news:

- `ai-complaint-summary.ts:aiComplaintSummary` and
  `ai-complaint-summary.ts:complaintSummaryUnavailability` are the zod
  schemas for a complaint summary and for the record of why one is
  unavailable.
- `release-news.ts` exports types only: `SourceRef`, `NewsAssignment`,
  `NewsOccurrence`, `ReleaseIdentity`, `ReleaseRelationship`,
  `ReleaseArticle`, and `NewsInference`.

Subdirectories:

- [cli](./cli/README.md): the `registerCliCommand` contract and the discovery
  of command folders.
- [services](./services/README.md): one client for each outside service,
  each calling through the cache of call results and files.
- [io](./io/README.md): canonical envelope IO, the import type registry, and
  the `excluded.yaml` and `PropertyCorrection` loaders.

## Invariants

- `source-namespace.ts:sourceNamespacePattern`: lower-case letters, digits,
  `.`, `_`, and `-`, in `/`-separated segments that each start with a letter
  or digit. `source-namespace.ts:assertValidSourceId` throws
  `Invalid source id: <id>` otherwise.
- `timestamp-schema.ts:timestampWithTimezone` rejects a timestamp without `Z`
  or a numeric UTC offset, and one whose date is not a valid calendar date.
- `timestamp-value.ts:timestampValue` discards fractional seconds before
  conversion and passes `null`, `undefined`, and non-timestamp fields through
  unchanged. For any other value of a listed timestamp field it throws a
  `ZodError` from `timestampWithTimezone` when the value has no explicit
  timezone or its date is not a valid calendar date.
- `license.ts:canonicalLicenseType` must byte-match the SQL
  `canonical_license_type` function (stated in the file's comment).
- `agency-address-schema.ts:agencyAddressText` rejects empty text and the
  placeholder values `null`, `0`, `x`, `xx`, `-----`, `n/a`, and `test`,
  compared case-insensitively.
- `agency-address-schema.ts:agencyZipCode` requires five digits or ZIP+4 and
  rejects `00000`.
- `agency-location-path.ts:requireAgencyPlaceLocationPath` throws:
  - When the id is not a string or no lookup is supplied:
    `Agency <agencyId> location_path_id must be verified as an existing place.`
  - When the lookup returns no row, a row whose `location_path_id` differs
    from the requested id, or a row whose level is not `place`:
    `Agency <agencyId> location_path_id <id> must reference an existing place; found <level|missing>.`
- `source-value-types.ts:cleanSourceValues` never changes or drops a value:
  it returns the input object as `spec` and every defect has
  `omitted: false`. It throws `Unknown source record kind <kind>` when there
  is no generated `<kind>Spec`.
- `data-annotations.ts:DataAnnotation`,
  `data-annotations.ts:CorrectionReplacement`, and
  `data-annotations.ts:SourceFieldEvidence` are strict objects: unknown keys
  are rejected. Each entry of `data-annotations.ts:SourceExclusions` is a
  strict object with non-blank `kind`, `key`, and `reason` and an optional
  `name`.
- `data-annotations.ts:replaceSourceExclusions` throws a `ZodError` when
  either argument is not a valid `SourceExclusions`.
- `data-annotations.ts:CorrectionReplacement` requires every correction, and
  `data-annotations.ts:SourceContribution` every field's evidence, to carry
  the same `source_namespace` and `source_record_id` as the contribution.
- `inspect-data-annotations.ts:inspectDataAnnotationFindings` throws
  `Missing source evidence for <kind>.<field>.` when a defect's field has no
  entry in `sourceValues`, and a `ZodError` when the `source_exclusions` of a
  `LicensingAuthority` is not a valid `SourceExclusions`.
- `ai-complaint-summary.ts:aiComplaintSummary` and
  `ai-complaint-summary.ts:complaintSummaryUnavailability` are strict; URLs
  must be `http` or `https`, `sha1` is 40 and `sha256` 64 lower-case hex
  characters, and `reason` is one of `missing_copy`, `pending`,
  `retrieval_failed`, `authentication_failed`, `generation_failed`, or
  `available_unsummarized`.

## Side Effects

- `source-value-types.ts:cleanSourceValues` caches each kind's phone, email,
  and URL field list in a module-level map on first use, and defaults
  `validationDate` to the current time.
- `agency-location-path.ts:requireAgencyPlaceLocationPath` calls the supplied
  lookup once when the id is a string and a lookup is supplied; otherwise it
  throws without calling it.
- All other files directly in this directory: None.

## Verification

- Run: `npx vitest run test/shared`
- Data annotation and source value checks:
  `npx vitest run test/import/artifacts/inspect-data-annotations.test.ts test/import/artifacts/data-annotations.test.ts test/import/artifacts/source-value-defects.test.ts`
