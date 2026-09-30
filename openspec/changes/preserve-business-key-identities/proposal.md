# Preserve business-key identities across resets

## Why

AuthorityLicense, License and ArrestProfile bypass durable identity storage.
The latest reset replaced 163,944 IDs despite unchanged entity keys.

## What Changes

Use the existing SourceNameToCanonicalId ledger in the shared business-key
resolver. Intake owns these derived source names: the entity kind and resolved
business-key columns, under namespace `intake`. Same-key source variants continue
to converge. Lookup order is command memoization, durable mapping, database,
then mint. Persist a recovered or minted ID before returning it.

Restore verified pre-reset identities from audit evidence into workspace mappings
through canonical IO. No record-specific code or direct database changes.

## Impact

No schema, seed, acquired source, dependency or generated contract changes.
The next normal rebuild applies the restored IDs and dependent references.
