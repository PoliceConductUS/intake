## Why

Seeded public display text currently includes all-caps department names such as `IRVING POLICE DEPARTMENT`, which makes downstream pages look like they are shouting. Normalizing these checked-in seed values fixes the source data instead of adding display-time cleanup that would hide bad records.

## What Changes

**Seeded Display Names**

- From: Some reader-facing agency names are stored in all caps in `supabase/seed.sql`.
- To: Seeded agency display names use readable title case while preserving acronyms where appropriate.
- Reason: Public pages should present agency and officer information as polished reader-facing text.
- Impact: Non-breaking seed data cleanup; IDs, slugs, URLs, and relationships remain unchanged.

**Seed Regression Coverage**

- From: No automated check prevents all-caps agency display names from returning to seed data.
- To: Tests check targeted seed display fields for all-caps phrase values.
- Reason: The seed file is large and easy to regress manually.
- Impact: Validation catches future presentation regressions before reset/deploy.

## Capabilities

### New Capabilities

- `seed-display-names`: Seed data stores reader-facing names and authored public notes without all-caps shouting-case display names.

### Modified Capabilities

None.

## Impact

Affected files:

- `supabase/seed.sql`
- `test/seed-display.test.ts`
- `openspec/changes/normalize-seed-display-names/**`

Affected systems:

- Supabase seed reset output and downstream site pages that read agency/officer display fields.

No migrations are required. No generated type refresh is required. Production would need a data correction/update plan only if these exact seeded rows have already been loaded into a persistent environment from the old seed values.
