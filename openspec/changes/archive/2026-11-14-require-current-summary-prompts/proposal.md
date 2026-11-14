# Require current summary prompts during rebuilds

## Why

A reset cleared the configured database before discovering that a retained Minnesota acquisition contained summaries from an obsolete prompt. Reset replay and summary validation were tested separately. Prompt text is embedded in TypeScript and its manually maintained version can drift from its contents.

## What Changes

- Store the Minnesota disciplinary-order prompt in a separate text file and identify it by its SHA-256 content fingerprint.
- Require current prompt fingerprints for reused and imported summaries. Regenerate stale analysis during acquisition; never relabel an obsolete result as current.
- Inventory and transform retained inputs before schema reset, restoring acquisition pointers on success or failure. Reject invalid inputs before clearing the database or retiring the active mutation chain.
- Preserve existing source order, chronological replay, canonical identities, correction state, and canonical mutation application.

## Impact

Intake acquisition output and analysis-cache metadata change. No database schema or public narrative fields change. Existing version-2 result metadata requires an explicit transition decision; version-1 results remain invalid. The database reset comparison remains pending until source preparation succeeds.
