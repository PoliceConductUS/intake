# Citation case slugs

## Why

The board selected Indigo Book full citations for all case URLs (INS-109, answered interaction 6f461b8b-31eb-482f-aad7-3f416d80f304). Current intake derives title-only slugs and preserves historical cached overrides.

## Changes

Use sourced full citations when available; otherwise use an explicit docket reference containing case name, exact docket number, court citation abbreviation, and filing date labelled as filed. A filing date is not a decision date. Use Free Law Project courts-db citation strings rather than hand-maintained court abbreviation rules. Never fabricate reporter citations or neutral identifiers. Existing case IDs remain unchanged.

Migration must preflight all records and produce before/after evidence, update database and canonical slug state coherently, preserve previous URL ownership, and allow safe reruns. Website redirects must resolve all old case URLs directly to built canonical pages. Unknown courts, missing fields, conflicting citations, and collisions fail visibly.

## Scope

Local implementation and isolated verification only. No new source acquisition or production deployment. Existing publication holds remain. Schema/cache/redirect contracts require coordinated intake and website PRs; no reset of shared state.
