## Why

Artifacts validation reports the failing field path but drops the validator's explanation, making source-data failures difficult to diagnose.

## What Changes

Report every validation issue in the Artifacts error, pairing each message with its field path and original rejected value. Update the generator and its generated output. Validation rules and source data remain unchanged.

## Impact

Only Artifacts validation diagnostics change. No migrations, seed changes, downstream data contracts, reset, or production migration are required.
