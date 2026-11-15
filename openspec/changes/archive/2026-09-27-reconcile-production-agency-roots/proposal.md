# Reconcile production and local agency roots

## Why

The earlier bootstrap input incorrectly used TX-only paths and the August backup. The user requires current live production versus the post-reset local database.

## What changes

Capture live production agency slugs, read the post-reset local agency slugs, and resolve production-only slugs through canonical slug/source mapping caches. Include resolved source IDs in initial root data, retaining existing roots and canonical identity. Record unresolved identities for review.

## Capabilities

Modified: agency-record-selection.

## Impact

Workspace InitialAgencyRoots data and accepted selection specification. No viewer changes. A local reset/rebuild from saved source exports is now authorized after pre-reset capture. Preserve the four Minnesota identities explicitly skipped by the user. Correct the four confirmed overlapping federal-source Agency mappings to the selected TCOLE identities. Preserve distinct agencies and current pipeline eligibility; report remaining source and selection gaps explicitly.
