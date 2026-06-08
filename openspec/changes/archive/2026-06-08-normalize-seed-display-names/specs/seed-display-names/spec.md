## ADDED Requirements

### Requirement: Reader-Facing Seed Display Names

Seed data MUST store reader-facing agency, federal agency, officer, and agency-officer title values in readable display casing. Seed display values MUST NOT use all-caps phrase casing unless the value is an acronym, state abbreviation, badge identifier, source title, URL, or other preserved source text.

#### Scenario: Agency names are seeded for public display

- **WHEN** `supabase/seed.sql` inserts a row into `public.agency` or `public.federal_agency`
- **THEN** the inserted `name` value uses readable display casing rather than all-caps phrase casing

#### Scenario: Officer and role names are seeded for public display

- **WHEN** `supabase/seed.sql` inserts officer names or agency-officer titles
- **THEN** the inserted display values use readable casing appropriate for a public page

### Requirement: Authored Public Notes Match Display Names

Project-authored seed notes that repeat agency or officer display names MUST use the same readable casing as the corresponding display value, while preserving quoted source titles and acronyms.

#### Scenario: Coverage notes reference normalized agencies

- **WHEN** project-authored `coverage_links.notes` or relationship notes reference a seeded agency by name
- **THEN** the note uses readable agency casing instead of all-caps phrase casing
