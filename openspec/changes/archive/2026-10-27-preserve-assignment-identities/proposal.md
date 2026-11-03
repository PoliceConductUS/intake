# Preserve assignment identities

## Why

MN POST currently ignores acquired activeEmployment rosterId values and builds
person/agency keys, replacing original assignment IDs and collapsing two distinct
assignments at the same agency. TCOLE leaves repeated internal whitespace in role
and license key components, producing a different key for the same service.

## What Changes

Use POST rosterId values from acquired detail records as assignment source names,
retaining every distinct assignment and updating discipline/coverage references.
Normalize structured text through shared per-property resolvers across sources.
Reuse that normalization for TCOLE assignment role/license key components.
Reuse the durable canonical mappings, with no source-specific exceptions or
runtime natural-key matching to database rows. Preserve raw acquired evidence.

## Impact

No schema migration or generated type change. Existing generated artifacts must
be transformed again. A fresh generation/reset uses the corrected source names;
already-applied mutation history is not rewritten by this code change.
