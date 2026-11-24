# facades

## Overview

`EntityFacade` resolves the properties of one record and plans the create or
update mutation envelope for it. Property values are memoized, and a
cacheable property is resolved in the order source value, cache, resolver.

`resolver-registry.ts` builds a facade for any kind from the generated entity
specs (columns, foreign keys, primary key, resolved properties) and a per-kind
`REGISTRY` of resolver overrides. The other files supply those overrides:
slug, agency coordinates and `location_path_id`, the `CoverageLink` id, child
paths, selector-to-id resolution, and a civil case's complaint summary.

Callers in the import are `../config.ts`, `../data-context.ts` and
`../resolver-kit.ts`. Source code also imports from here:
`sources/org/policeconduct/manual/entity-model.ts` uses
`identityColumnForKind`, and `sources/lib/news.ts` and two files in
`sources/com/serpapi/landing-page-search` (`aliases.ts`, `publication.ts`)
use `normalizeCoverageUrl`.
No file here touches disk, network, `process.env` or logging directly; every
effect goes through an adapter passed in.

## Interface

- `entity-facade.ts:EntityFacade` - class; constructor
  `(kind, columns, resolvers, mutations, options)`; methods `merge`, `value`,
  `raw`, `correction`, `recordSourceContribution`, `contribution`,
  `resolvedRow`, `toMutation`; getters `inspectionValues`,
  `supportsSourceEvidence`, `sourceIdentity`.
- `entity-facade.ts:EntityFacadeBackend` - the backend adapter type: canonical
  id, foreign key, business key and selector lookups, plus `existingRow(id)`
  and `getLocationPathByPath(path)`.
- `entity-facade.ts:EntityResolvers` - a partial map of column to `Resolver`.
- `entity-facade.ts:MutationConstructors` - `{ create, update? }` envelope
  constructors.
- `entity-facade.ts:EntityFacadeOptions` -
  `{ current?, source, backend, identity?, cache?, cacheableProperties? }`.
- `resolver-registry.ts:buildFacadeForKind` -
  `(kind, { current?, source, backend, cache? })` returns an `EntityFacade`.
- `resolver-registry.ts:isRegistryKind` - true for every kind in
  `RECORD_KINDS_IN_DEPENDENCY_ORDER` except `STREAM_ONLY_KINDS`.
- `resolver-registry.ts:identityColumnForKind` - `PRIMARY_KEY_BY_KIND[kind]`,
  or `id`.
- `resolver-registry.ts:urlOwnershipForKind` - `{ property, owner }` for
  `LocationPath` and `LocationPathAlias`, otherwise `undefined`.
- `agency-personnel-resolvers.ts:entitySlugResolver`,
  `agency-personnel-resolvers.ts:personnelSlugResolver`,
  `agency-personnel-resolvers.ts:agencySlugResolver` - slug resolvers.
- `agency-personnel-resolvers.ts:SlugBackend` - `ensureUniqueSlug`,
  `registerSlug`, `existingRow`.
- `coverage-resolvers.ts:normalizeCoverageUrl` - `(rawUrl)` returns the
  normalized URL.
- `coverage-resolvers.ts:coverageLinkIdResolver` - resolver for the
  `CoverageLink` id.
- `geocode-resolvers.ts:latLngFromAddress` - `(config)` returns resolvers for
  the latitude, longitude and location-path-id columns.
- `geocode-resolvers.ts:GeocodeConfig` - the parameter type of
  `latLngFromAddress`.
- `geocode-resolvers.ts:LocationBackend` - `getLocationPathById`,
  `resolveAgencyCoordinates`, `resolveAgencyLocation`.
- `complaint-summary-resolvers.ts:complaintSummaryResolvers` - `()` returns
  the resolvers of `ai_complaint_summary` and
  `complaint_summary_unavailability` for `CivilCase`.
- `complaint-summary-resolvers.ts:summarizeComplaint` -
  `({ docketUrl, docketId, sourceNamespace, clients, prompt? })` returns
  `{ status: "skipped" }` or
  `{ status: "done", ai_complaint_summary, complaint_summary_unavailability, findings }`.
- `complaint-summary-resolvers.ts:selectComplaint` - `(entries)` returns
  `{ doc, date }` for the latest identified complaint, or `undefined`.
- `complaint-summary-resolvers.ts:COMPLAINT_SUMMARY_MODEL`,
  `complaint-summary-resolvers.ts:COMPLAINT_SUMMARY_PROMPT` - the model
  asked for (`claude-opus-5`) and the prompt sent with a complaint's text. The
  summary's `model` is the model the response named, from the call's outcome.
- `complaint-summary-resolvers.ts:ComplaintSummaryBackend` -
  `serviceClients()`.
- `path-resolver.ts:childPathResolver` - `({ property, parent, label })`
  returns a resolver for `${parent}${segment}/`.
- `selector-resolver.ts:resolveIdBySelector` -
  `(kind, selector, findRows)` returns the id of the one matching row.
- `selector-resolver.ts:Selector`, `selector-resolver.ts:SelectorRowFinder` -
  types.

## Invariants

- `entity-facade.ts:EntityFacade.inspectionValues` - throws when read before
  `toMutation` has run.
- `entity-facade.ts:EntityFacade.value` - throws when a cache correction on
  the identity column differs from the resolved identity.
- `entity-facade.ts:EntityFacade.computeValue` - throws on a circular property
  dependency. `slug`, and any property not in `cacheableProperties`, bypasses
  the cache.
- `entity-facade.ts:EntityFacade.resolveThroughCache` - a source-provided
  value is returned without a cache read or write; a cache hit is passed to
  `resolver.validate`; null and undefined results are not written.
- `entity-facade.ts:EntityFacade.resolveWithDiagnostics` - a resolver failure
  on a cacheable property with no source value is rethrown as
  `CacheCorrectionError`. A `CacheCorrectionError`, a
  `CensusGeocoderRequestError`, and an `UnresolvedPropertiesError` that names
  no cacheable property are rethrown unchanged.
- `entity-facade.ts:EntityFacade.resolvedRow` - with
  `source.action === "PATCH"`, a column absent from the source is not
  resolved. A `DATE_PROPERTIES` value that `representableDate` rejects is
  written as `null`.
- `entity-facade.ts:EntityFacade.toMutation` - throws when an existing row is
  found and no update mutation is configured, and when `source.commandName`
  is absent. `data_source_values` is the current row's value with this
  source's contribution laid over it, and `source_exclusions` is merged with
  the current row's value through `replaceSourceExclusions`.
- `agency-personnel-resolvers.ts:slugResolver` - throws on a blank or
  non-string cached slug, on a cached slug that differs from the database
  slug, and on a correction that differs from the established slug. Not
  exported.
- `agency-personnel-resolvers.ts:entitySlugResolver`, `personnelSlugResolver`,
  `agencySlugResolver` - throw
  `Cannot generate slug for <kind> <namespace>/<name>; <field> is required.`
  when the record has no `title` or `name` (the field given), `first_name`,
  or `name`, in that order.
- `coverage-resolvers.ts:coverageLinkIdResolver` - throws when the record has
  neither `source_namespace` nor `url`.
- `geocode-resolvers.ts:latLngFromAddress` - with `config.requirePlace`, the
  location-path value is checked by `requireAgencyPlaceLocationPath`.
- `complaint-summary-resolvers.ts:complaintSummaryResolvers` - one
  resolution for each case fills both fields. It runs only when the case's
  `primary_source_url` is a docket on `https://www.courtlistener.com`
  (`docketIdFromUrl`); any other case keeps the values its source supplied,
  and `keepFindings()` is called. Neither field is cached as a resolved
  property.
- `complaint-summary-resolvers.ts:summarizeComplaint` - the steps, each
  through its service client: the docket's entries (asked again after 120
  days), the latest identified complaint, its download from
  `https://storage.courtlistener.com`, a check that the bytes start with
  `%PDF-`, the file's SHA-1 against the one CourtListener records, its text,
  and the model's summary. A problem ends the work with no summary, the
  unavailability state of its code and one finding:

  | Code                   | Problem                                                                               | Reason                 | Type    |
  | ---------------------- | ------------------------------------------------------------------------------------- | ---------------------- | ------- |
  | `complaint-entries`    | The entries call failed, or the entries do not have the expected shape                | retrieval_failed       | error   |
  | `complaint-not-found`  | No complaint is identified                                                            | pending                | warning |
  | `complaint-no-copy`    | The complaint is not available, or has no file path on `storage.courtlistener.com`    | missing_copy           | warning |
  | `complaint-no-check`   | CourtListener records no 40-character SHA-1                                           | retrieval_failed       | error   |
  | `complaint-download`   | The download failed                                                                   | retrieval_failed       | warning |
  | `complaint-not-pdf`    | The bytes do not start with `%PDF-`                                                   | retrieval_failed       | error   |
  | `complaint-no-text`    | The text call failed, or every page is blank                                          | available_unsummarized | warning |
  | `complaint-no-summary` | The model call failed, or the summary cites a page number above the file's page count | available_unsummarized | warning |

  `complaint-mismatch` (error) does not end the work: the served file is
  read and summarized, and the summary's `source.sha1Verified` is `false`.
  When any client answers `skipped`, the result is `skipped`: the resolvers
  return no value for either field, report nothing and call
  `keepFindings()`.

- `complaint-summary-resolvers.ts:summarizeComplaint` - each finding has
  field `ai_complaint_summary`, the docket ID as its source record ID, and
  evidence of the docket, the complaint document once one is identified, and
  the downloaded file (with `retrieved_at` and `sha256`) once there is one.
  Its value is null before a complaint is identified, the HTTP status for
  `complaint-download`, `{ recordedSha1, servedSha1, servedSha256, bytes }`
  for `complaint-mismatch`, and the document number otherwise. The state's
  `detail` is the finding's message, its `sourceUrl` the address the message
  gives, and its `checkedAt` the completion time of the call result that
  decided the outcome.
- `complaint-summary-resolvers.ts:complaintMessage` (not exported) - the
  reader-facing message of each code and the address it gives. The texts are those of
  the `courtlistener-complaint-summaries` spec. The complaint's address is
  its page on `https://www.courtlistener.com`, and the docket's address when
  the document has no page there.
- `complaint-summary-resolvers.ts:selectComplaint` - a document that is not
  an attachment is a candidate when its description or its entry's
  description starts with a complaint label: an optional ordinal, then any
  of "amended", "corrected" or "supplemental", then "complaint". An
  attachment is a candidate only when its entry's description starts with a
  complaint label and its own description is only a complaint label,
  optionally after "Additional Page(s)" or "Plaintiff's". An unnumbered
  entry's document is left out when it has no document number, PACER id,
  file, SHA-1 or URL, is not available, and a numbered complaint entry has
  the same `docket`, `date_filed`, `time_filed` and `recap_sequence_number`.
  The candidate with the highest entry number is selected; on a tie, an
  attachment comes first. It throws a `ZodError` when an entry's
  `recap_documents`, a candidate document, its entry's `date_filed` or its
  entry's `entry_number` does not parse.
- `path-resolver.ts:childPathResolver` - a value supplied in the record is
  returned without any check. Otherwise it throws on a missing reference
  field, a missing foreign-key target, a target whose property is empty, an
  empty label, a label that gives an empty segment, or a parent that does not
  start and end with `/`.
- `selector-resolver.ts:resolveIdBySelector` - throws on zero matches and on
  more than one match.
- `selector-resolver.ts:resolveCandidates` - throws for a foreign-key key
  given a value instead of a nested selector, for a scalar column given a
  nested selector, and for an empty selector. Not exported.
- `resolver-registry.ts:annotationSubjectResolver` - throws unless the subject
  kind is in `PRIMARY_KEY_BY_KIND` and the subject id is present. Not
  exported.
- `resolver-registry.ts:REGISTRY` - the `DataAnnotation.type` resolver throws
  `Supplying annotation type correction requires an explicit replacement_value, including null when intended.`
  for type `correction` with no `replacement_value`. Not exported.
- `resolver-registry.ts:createSpecForKind` - throws
  `No CreateSpec for kind <kind>; cannot derive its columns.` Not exported.
- `resolver-registry.ts:mutationsForKind` - throws when `${kind}Create` is
  absent from `importMutationEnvelopeTypes`.

## Side Effects

- `entity-facade.ts:EntityFacade.resolveThroughCache` - reads and writes the
  property cache through the `PropertyCache` adapter passed in.
- `entity-facade.ts:EntityFacade.toMutation` - reads the existing row through
  `backend.existingRow` when `options.current` is not supplied.
- `agency-personnel-resolvers.ts:slugResolver` - `PropertyCache` read and
  write; `backend.existingRow`, `backend.ensureUniqueSlug` and
  `backend.registerSlug` through `SlugBackend`.
- `coverage-resolvers.ts:coverageLinkIdResolver` -
  `backend.findOrCreateCanonicalId`, `backend.findIdByBusinessKey` and
  `backend.mintId`.
- `complaint-summary-resolvers.ts:complaintSummaryResolvers` - calls
  CourtListener, the file download, the PDF text programs and the Anthropic
  API through `backend.serviceClients()`, which reads and writes the cache
  of call results and files.
- `geocode-resolvers.ts:latLngFromAddress` - calls
  `backend.resolveAgencyCoordinates` and `backend.resolveAgencyLocation`
  through `LocationBackend`.
- `path-resolver.ts:childPathResolver` - `backend.findForeignKeyTarget`.
- `selector-resolver.ts:resolveIdBySelector` - calls the `SelectorRowFinder`
  passed in.
- `resolver-registry.ts:annotationSubjectResolver` - `backend.existingRow`
  when the record lacks `subject_kind` or `subject_id`, and
  `backend.findForeignKeyTarget`.
- `resolver-registry.ts:configurationForKind` - fills the in-memory
  `CONFIGURATIONS` map, once per kind.

## Verification

- Run: `npx vitest run test/import/entity-facade.test.ts test/import/selector-resolver.test.ts test/import/resolver-omission.test.ts test/import/complaint-summary.integration.test.ts`
- Run: `npx vitest run test/import/artifacts`
