## Why

Arrests, reports and civil cases can name an agency without naming the officer. The owner asked on 2026-11-22 how to attach such records, noting that almost all data connects to an `agency_personnel` row and that an arrest with no identified officer is a data defect. Without a decision, these records are either dropped or shown by a site-side rule, and the owner forbids both.

## What Changes

This change is a design for the owner to choose from. Nothing is implemented until the owner picks an option.

- **Choice-independent rules (specified now):** a record with a known agency and an unknown officer is stored and linked to its agency; it carries an annotation saying the officer is not identified; it never counts as staff and never creates a personnel page; a database view presents these records per agency.
- **Option A:** a real "Unknown" `personnel` and `agency_personnel` row per agency, excluded from inclusion, counts and pages.
- **Option B (recommended):** a virtual entry. Records keep `agency_id` and have no officer link; civil cases gain a `civil_case_agency` link table; the view `agency_unknown_officer_record` presents one "Unknown officer" entry per agency.
- **Option C:** an `agency_personnel` row with a null `personnel_id` per agency.

## Capabilities

### New Capabilities

- `unknown-officer-records`: How records with a known agency and an unknown officer are stored, annotated, excluded from staff counts and presented by a database view.

### Modified Capabilities

None until the owner chooses. Option B would modify `agency-record-selection` (a case-to-agency link table); Option C would weaken the required `agency_personnel.personnel_id`.

## Impact

- **Supabase migrations:** depend on the option. B: `civil_case_agency` table and the view. A: discriminator column on `personnel` and exclusions in every `site_*` view. C: `agency_personnel.personnel_id` nullable with a check.
- **Intake sources:** the arrest source, the report sources and civil case sources emit the chosen form.
- **Data reset:** required for any option.
- **Downstream contract (website, cross-repo note):** the agency page shows the view's "Unknown officer" entry.
- **Related changes:** `import-arrest-records` (arrests), `supply-site-display-data` (`reviews.agency_id`, count and selection views).
