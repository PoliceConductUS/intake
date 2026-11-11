# Eight additional confirmed location aliases

Applied locally on 2026-09-21 from `redesign-config-driven-intake`.
The [exact batch and identity evidence](additional-aliases.json) covers audit
rows 2, 8, 65, 71, 79, 93, 94, and 97. The [current 104-row review](review-104.csv)
records every disposition.

## Applied data

- Manual history now contains 28 curated aliases; its previous 20 records are
  unchanged. The canonical manual source performed all validation and writes.
- Generated entry `data/mutations/000010-org.policeconduct.manual.DatabaseMutations.yaml`
  contains exactly eight `LocationPathAliasCreate` operations and twenty
  `LocationPathAliasRead` operations for the existing records. Inspected every
  create against the reviewed target ID before applying the single pending entry.
- Aliases increased from 1,476 to 1,484. Every column of all 35,249 canonical
  locations and all 1,476 existing aliases remained unchanged.
- All eight added paths resolve to their reviewed canonical IDs and paths;
  all ten data-chain checksums pass.
- Queried all 104 audited paths: 47 resolve, 57 remain unresolved. All 104 old
  location IDs remain absent; aliases preserve URLs, not retired IDs.
- No raw sources were downloaded. No production database, agency assignment,
  schema, seed, or application code was changed.

The reviewed input for this application is retained at:

`/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/command/2026-09-21T06-13-08-325Z-tjhbnm3bnpd421xofgc67xco/org.policeconduct.manual/output/reviewed-aliases.json`

Manual source history and data-chain files are in the local workspace outside
Git. The reviewed alias batch and evidence are checked in on redesign. A reset
followed by replay of this workspace chain retains these aliases.

## Validation

- Manual-source tests: 2 files, 8 tests passed.
- Fresh migrated database replay: all 10 entries passed; all 28 curated aliases
  resolve to the same IDs and paths; 35,249 canonical locations and 1,484 aliases;
  all chain checksums pass. Temporary database removed after verification.
  This tests migrations plus data replay, not the separate Supabase seed reset.
- OpenSpec: all 11 items passed. Scoped formatting and whitespace checks passed.
