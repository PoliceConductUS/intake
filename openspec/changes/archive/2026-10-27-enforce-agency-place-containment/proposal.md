# Enforce agency place containment

The location resolver contradicts accepted ADR 0024 and the accepted import
specification by assigning a county-local name match, statewide name match, or
nearest place when no place polygon contains the address point. Sam Rayburn ISD
demonstrates the defect: its point is in Fannin County but its assigned place is
Ivanhoe in Tyler County.

The coordinate resolver also substitutes city/place/ZIP centroids after a
failed street geocode, contrary to the accepted address-coordinate specification.
Remove that substitution and require one-time re-resolution of old derived
coordinate caches; explicit source coordinates and manual cache corrections retain their
existing precedence. No new source acquisition or bulk live geocoding is run.

Remove those three unsupported resolution paths and their unused database
helpers. Remove the hard-coded postal-area exceptions and city spelling
rewrites. Report source identity, canonical ID, address, and point when
resolution fails. Ensure old cached or existing-row assignments do
not bypass the corrected resolver when a derived location is prepared again.

No schema, seed, source acquisition, or production deployment is required.
Existing immutable mutation entries are not rewritten. Records without a valid
containing place or explicit manual resolution must fail preparation until their source
coordinates or baseline geography are corrected; this change does not invent
replacement locations or delete agency data.
