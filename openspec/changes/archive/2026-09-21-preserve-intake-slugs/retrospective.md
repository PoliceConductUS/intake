# Retrospective

## Outcome

Canonical database and cached slugs are preserved during imports. Stale replay changes to established URL fields fail loudly. Historical slugs were restored by exact ID, with cache backups, reference digests, a rolled-back rehearsal, and post-commit verification.

## Corrections during implementation

The initial investigation treated producer slug fields as authoritative. The user clarified that uniqueness and ownership belong to intake; the design was corrected before implementation and no producer slug assignment was added.

Activating existing-row updates exposed two issues caught in review: omitted source fields could be null-filled, and JSON comparison used object identity. Narrow fixes preserve source field ownership and compare JSON structure after serialization.

## Remaining integration boundary

The code stays on the scoped fix branch until integration. The local dataset correction is already applied. The separate table-name contract and fresh site build remain outside this patch; no deployment was performed.
