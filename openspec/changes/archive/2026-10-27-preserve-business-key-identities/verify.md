# Verification

- Six reset-style regressions failed before the fix because AuthorityLicense,
  License and ArrestProfile returned replacement IDs after reopening the ledger
  with an empty database. All six pass with the fix.
- An additional license/type test verifies dependent IDs and generated create
  mutations remain identical across a fresh context and empty database.
- Ledger tests cover recovered-ID persistence, reverse lookup, resolution failure
  and a real canonical-IO write failure.
- Type checking, build, scoped formatting and OpenSpec validation pass (22 items).
- Expanded artifact/state/facade suite: 332 passed, one pre-existing civil-case
  ordering test failed. The same failure was reproduced with all affected source
  files and that test restored to unchanged HEAD `745605d`. It concerns the order
  of summary updates from two case sources; this change does not modify that
  behavior or its assertions. Evidence is retained in the workspace audit.

## Workspace correction

Restored 13 authority-license IDs and 163,611 license IDs from the immediately
preceding audited reset snapshot. Restored 320 arrest-profile IDs from its recorded
mutation history, previously verified against the current records by assignment
and identical content. There were no existing intake business-key mappings to
replace. All writes used the existing ledger and canonical envelope IO.

Reopened the store and verified all 163,944 identities through the production
business-key resolver with database lookup and minting disabled. All forward and
reverse mappings round-trip. These are pre-reset IDs, not a claim that every ID
originated in the August production export.

Receipt and reproducible restoration script:
`$INTAKE_WORKSPACE/audits/preserve-business-key-identities-20260924/`.

No database writes, data reset, acquisition, transformation, generation or import
were performed. The next user-run reset applies the workspace corrections.

## Separate review observation

The existing canonical filename contract uses the encoded source name directly.
A hypothetical long AuthorityLicense name can exceed the filesystem filename
limit once combined with its business key. None of the 163,944 audited keys
encountered this limit. General filename handling is outside this correction.
