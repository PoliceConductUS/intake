## Design Summary

Seeded public display text should read like reader-facing names, not shouting-case source labels. The user-visible problem is uppercase department names such as `IRVING POLICE DEPARTMENT` appearing directly from `supabase/seed.sql`.

The smallest correct change is to normalize checked-in seed display values to title case where the value is a reader-facing agency, officer, or role/name field. Stable IDs, slugs, URLs, state abbreviations, acronyms, source titles, and provenance meaning should remain unchanged.

## Alternatives Considered

### Option A: Normalize in application display code

- **Approach**: Transform agency/officer strings at render time.
- **Pros**: Avoids editing large seed data.
- **Cons**: Hides bad seed values, creates duplicated formatting behavior downstream, and does not fix any non-site consumers of the database.
- **Why not chosen**: The source of the visible problem is seed data, and this repository treats behavior/data shape as source-controlled.

### Option B: Normalize seed display fields only

- **Approach**: Update seed values for reader-facing agency names and obvious public notes that repeat those names in all caps; add a regression test for display fields.
- **Pros**: Fixes the source, keeps the change scoped, avoids runtime fallback behavior, and preserves durable IDs.
- **Cons**: Does not mechanically rewrite every uppercase phrase in source titles or acronyms.
- **Why chosen**: It directly solves the page quality issue without changing data identity or source evidence.

### Option C: Add a generalized SQL text normalizer

- **Approach**: Add tooling to parse and title-case all seed SQL string literals.
- **Pros**: Broad coverage.
- **Cons**: High risk of corrupting acronyms, quoted source titles, legal names, URLs, and evidence text.
- **Why not chosen**: This would be speculative complexity for a presentation problem.

## Agreed Approach

Use Option B. Normalize reader-facing seed display values at the source and add a focused test to prevent all-caps agency names from being reintroduced.

## Key Decisions

- `public.agency.name` and `public.federal_agency.name` values are display names and should not be stored in all caps unless the official name is an acronym.
- Officer names and agency officer titles should remain title case; existing values are mostly already compliant.
- Source titles and acronyms should not be normalized merely because they contain capital letters.
- Coverage/provenance notes that repeat normalized agency names should use the same reader-facing casing when the text is authored by this project.

## Open Questions

None for this scoped cleanup.
