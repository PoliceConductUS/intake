# Restore Oregon roster personnel

## Why

The Oregon transform omits people without selected certificate types. This omits 2,887 previously public profiles; one additional public profile has a temporary source-name exclusion whose source now supplies the corrected name. The user chose full roster inclusion with optional certificates and requires public URLs to survive.

## What Changes

Remove the certificate inclusion condition; retain all roster personnel and supported employment/credential records. Do not add the proposed inclusion command. The mistakenly created local manual-correction rule was removed through a tested temporary CLI operation without changing database rows. That local cleanup is complete; the temporary operation is withdrawn from the delivered code. Update the existing source scope specification and regression tests. Apply normal generated mutations while retaining established IDs and slugs.

## Impact

Oregon transform and source tests/documentation. No cache CLI or shared property-correction behavior changes are delivered. No schema, new identity mechanism, publication flag, raw-input edit or reset is required. Existing active-branch changes remain intact.
