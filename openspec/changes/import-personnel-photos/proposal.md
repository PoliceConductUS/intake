## Why

Personnel portraits must survive rebuilds through intake data rather than website filename mappings.

## What Changes

Add a personnel_photo association and a local-file CLI import using the shared manual source and mutation chain. Store content-addressed image bytes in the intake workspace. Website renders the database-associated image and copies verified bytes into static output.

## Impact

New additive migration, generated envelope types, manual-source record kind, CLI and website loader/build contract. No reset or seed records. Apply migration before generating import schemas or website builds.
