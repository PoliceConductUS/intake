## 1. Source discovery

- [x] 1.1 Inventory and approve the old-to-new namespace map, including request-only sources and sources hosted by intermediaries.
- [x] 1.2 Move the source folders and markers, update imports and workflows, and share discovery and validation across CLI entry points.
- [x] 1.3 Define the shared `IntakeSource` contract and use each source’s exported entry point for discovery and execution.

## 2. Persisted data

- [x] 2.1 Update state, command and ledger path construction and parsing. Exercise nested paths, opaque URL record IDs and interrupted commands.
- [x] 2.2 Migrate retained local data and verify integrity, pointers, canonical IDs and slugs before switching the workspace.
- [x] 2.3 Update namespace-bearing database and website consumers and run the requested no-acquire rebuild.

## 3. Verification

- [x] 3.1 Exercise CLI listing, selection, requests, transforms and the landing page worker, and verify both repositories against the rebuilt database.
