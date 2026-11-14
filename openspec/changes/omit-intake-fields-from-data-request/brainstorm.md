## Design Summary

`docs/data-request-format.md` is generated from the database schema and tells
a provider what it can send in the Institute's native format. It was last
generated at schema `20261010000000`, and it already listed a few fields only
the Institute fills in. Regenerating it at the current schema would add more:
annotations, AI complaint summaries, and intake's own bookkeeping.

The user's rule (2026-11-13): the data request must not expose internal
fields, annotations, or other information under the Institute's exclusive
control. The generator now omits those fields and record types, and the
document is regenerated. A new test fails whenever a committed generated file
differs from its generator's output, so the document cannot go stale again.

## Alternatives Considered

### A: Omit Institute-controlled columns and record types in the generator (chosen)

- **Approach**: extend the generator's existing omission sets.
- **Pros**: uses the mechanism already there for `slug`, `location_path_id`,
  and `ArrestProfile`; smallest change.
- **Cons**: the sets are maintained by hand.

### B: Regenerate without omissions

- **Approach**: commit the generator's current output.
- **Pros**: no generator change.
- **Cons**: the public request asks providers for the Institute's own data.
- **Why not**: rejected by the user.

### C: Leave the document stale and test only generated code

- **Approach**: exclude the document from the new test.
- **Pros**: no document change.
- **Cons**: the document stays out of date and unprotected.
- **Why not**: rejected by the user.

## Agreed Approach

Alternative A.

## Key Decisions

- Omitted fields, on every record type: `ai_complaint_summary`,
  `complaint_summary_unavailability`, `created_by`, `data_source_values`,
  `normalized_url`, `source_exclusions`, `source_namespaces`, `updated_by`.
- Omitted record types: `AgencyArrestProfile`, `DataAnnotation`,
  `PersonnelPhoto`.
- Which fields count as Institute-controlled was the implementer's reading of
  the user's rule. Fields left in and not yet ruled on:
  `CoverageLinkAgencyPersonnel.confidence`, `Agency.status` and `status_date`,
  the `Personnel.deceased_*` fields, and the `Review*` and `CoverageLink*`
  record types as a whole.
- The format version in the document moves to `20261112000000`.

## Open Questions

- Should any of the fields and record types listed above as not yet ruled on
  be omitted too?
