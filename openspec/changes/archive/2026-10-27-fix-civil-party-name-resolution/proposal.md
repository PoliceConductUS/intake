# Fix civil-party name resolution

## Why

Acquired Chief Mike Gudgel and Officer Bryan Pham names are excluded by inconsistent whitespace handling and an institution substring filter. Once admitted, titles are incorrectly scored as first names.

## What Changes

Collapse whitespace before person-name filtering. Match office as a whole word, preserving other institution and anonymous-party exclusions. Exclude the observed Officer and Chief prefixes from first/last-name scoring without weakening match or ambiguity thresholds. Preserve raw acquired data.

## Impact

Shared civil-party filter and name matching only. No schema, IDs, slugs, imports, database resets, acquisition changes, or source-specific exceptions.

The user subsequently authorized likely matches from compatible initials. Admit initial-led party names and compare first/middle initials to roster names, using known middle names to distinguish candidates. Record actual replay matches, including extra matches from separate acquired agency scopes, before any import.
