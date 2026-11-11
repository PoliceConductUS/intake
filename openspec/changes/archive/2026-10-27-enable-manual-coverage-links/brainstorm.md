## Design Summary

Enable the existing manual intake flow to accept coverage articles and links to existing agency personnel. The delegated scope specifies the two supported kinds and unchanged emission.

## Alternatives Considered

Extending the supported-kind list reuses existing schemas and identity handling. A custom article importer would duplicate those behaviors and exceed the requested scope.

## Agreed Approach

Add CoverageLink and CoverageLinkAgencyPersonnel to the existing supported-kind list.

## Key Decisions

Keep source references unchanged. Do not create personnel records or assign canonical IDs in acquisition/transformation. Preserve the current checkout as explicitly instructed.

## Open Questions

None for this bounded change.
