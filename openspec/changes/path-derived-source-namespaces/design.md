## Source layout

The source root is the repository's `sources/` directory. For example, `sources/com/serpapi/landing-page-search/intake.source.ts` yields `com/serpapi/landing-page-search`. The same path works when the repository is installed in another directory. A configured private data workspace can live on a different volume.

Each source exports its definition from `intake.source.ts` as an object checked against the shared `IntakeSource` TypeScript contract. Its folder supplies its namespace. The definition exposes the operations the source supports and the metadata used by Intake, including the kinds a transform produces. It can delegate to existing implementation files. Discovery, catalog listing, request handling, acquisition, transformation, and daily execution use the exported definition. A request-only source can omit acquire and transform. The daily worker keeps its existing schedule. Helpers under `sources/lib/` have no entry point.

## Naming

For downloaded data, reverse the actual download hostname, including subdomains, and append a path when needed to distinguish a source. Wikipedia's federal agency list is downloaded from `en.wikipedia.org`. PoliceActivity uses `com/youtube/policeactivity` for its channel. The Police Sexual Violence Project uses `org/psvproject/arrest-tracker` for its annual workbooks. Its tracker links the distinct 2025 and 2026 documents hosted on Google Sheets. For local workbooks and request-only sources use the issuing organization’s domain. Preserve the actual upstream URL in provenance. Record mixed-host sources and sources with no download URL explicitly when choosing their paths.

## State and commands

For namespace N, use `state/N/` for source phase state and `command/<existing-run-id>/N/output/` for command outputs. The source identity ledgers under the workspace's namespaces directory use the same nested segments. Preserve command IDs and chronological ordering. Separate source namespace path segments from opaque record IDs, including article URLs. Remove fixed-depth assumptions in path parsing and comparison. Reject absolute paths, empty components and dot traversal. List, select and run sources through one recursive discovery implementation.

## Existing workspace

Inventory the mapping for every active source and every retained workspace namespace. Identify the owner before moving files. Verify the move is one-to-one and identify collisions before writes. Migrate the state paths, acquisition and resume pointers, command paths, namespace-bearing envelopes, source-name and reverse-ID ledgers and source references together. Preserve raw acquired files, canonical IDs, slugs, and external publisher URLs. Inventory checksum-bearing artifacts and their referring records. Regenerate derived artifacts from their retained inputs and verify the historical mutation chain independently before switching configuration to the sibling `dev` workspace. Keep `dev-copy` as the read-only recovery workspace. Interrupted migration must resume without minting replacement IDs. The previously discarded news namespaces are outside this migration.

## Acquisition history

Every successfully completed acquire execution qualifies, including older commands and successful zero-record runs. An interrupted command can leave a populated output directory. Record success outside the output directory for new commands. For older commands consult positive execution evidence and report missing outputs or unconfirmed status. Keep the original workspace available for recovery.

## Verification

Run source listing, request-only discovery, targeted and wildcard selection, transform and no-acquire reset using nested paths. Verify before/after record counts and identity mappings, command references and checksums. Compare the relevant website source identities and run both repositories' gates.
