# Verification

The regression tests failed before implementation: MN emitted composite keys,
collapsed distinct POST jobs, and referenced the replacement keys; TCOLE left
repeated spaces in the service key. Shared text-resolver regressions also failed
before implementation. The corrected source/import suites pass (482 tests).
Type checking, build, and all 19 OpenSpec validations pass. Independent code
review found no actionable correctness issues.

The real acquired inputs produce 11,309 MN assignments and 170,487 TCOLE
assignments. POST rosterIds recover 10,956 of the 10,959 audited original MN IDs,
including both distinct Primary/Secondary jobs at the same agency. Three records
have genuinely changed POST rosterIds; matching fields alone is insufficient to
merge them, especially because the stored start date is a license issue date.
Those three remain separately documented in workspace audit results.

347 newer assignments lacked rosterId mappings. Their exact existing canonical
IDs were preserved through verified forward/reverse mapping records, written
using canonical IO; no new canonical IDs were minted for this repair.
The normalized TCOLE key resolves to original assignment
`cm76wpyf44qpavrvgzgava2rm`. A scan of all durable TCOLE assignment
keys found one additional whitespace variant without a normalized mapping;
its existing ID `x0dkvdlb4r5jap8nkpyosl28` was preserved by adding the normalized
forward mapping and updating the reverse mapping through canonical IO.

Evidence and mapping receipts:
`/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/assignment-identity-fix-20260923/`.

The current database and existing mutation history were not changed. The next
`npm run cli -- data reset --no-acquire` transforms existing inputs again and
uses these corrected identities. Do not add `--no-transform`: earlier artifacts
contain the old assignment keys. No acquisition, schema migration, or production
write is required.
