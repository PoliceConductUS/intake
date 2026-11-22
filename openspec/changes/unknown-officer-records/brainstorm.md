## Design Summary

This brainstorm was not run as an interactive session. Its inputs are the owner's decisions of 2026-11-22 in `policeconduct.org` `.egm-reviews/owner-decisions-round1.md`:

- "Open design question: how to attach records/reports/arrests whose officer is unknown but agency is known (e.g. an 'unknown' personnel/assignment record per agency?). Almost all data connects to an agency_personnel record, rarely to a personnel record."
- "an arrest with no identified officer looks like a data defect; the 'known officer' design may need to be done soon. Unknown-officer handling needs brainstorming: possibly a special Unknown personnel record per agency (excluded from agency inclusion, personnel counts, etc.) or a virtual record."

The records concerned:

- **Arrests** (`import-arrest-records`): `arrest.agency_id` is always set; resolved officers are `arrest_agency_personnel` rows.
- **Reports**: `reviews.agency_id` is added by `supply-site-display-data`; officers are `review_personnel` rows.
- **Civil cases**: officers are `civil_case_personnel` rows; there is no case-to-agency link without an officer (`agency-record-selection` says selection uses `CivilCasePersonnel -> AgencyPersonnel -> Agency` "without introducing a CaseAgency table").

The question is how a record says "this agency, officer not identified", and how pages show it, without the site deciding anything.

## Alternatives Considered

### Option A: A real "Unknown" personnel row and assignment per agency

- **Approach**: When a source has a record with a known agency and no identified officer, intake creates (once per agency) a `personnel` row named "Unknown" and an `agency_personnel` row at that agency. The record links to that assignment like any other. Every selection and count view excludes these rows, found by a discriminator column (for example `personnel.kind = 'unknown_officer'`).
- **Pros**: Every record keeps one path, record → `agency_personnel` → `agency`, as the owner noted most data does. Civil cases need no new table. Existing joins work.
- **Cons**: It stores a person who does not exist as one row; one "Unknown" row stands for many different people. Every count and selection view, the search index, the sitemap and structured data must exclude it; one missed exclusion publishes a fake officer page or inflates staff counts. `personnel.slug` is required and unique, so each Unknown row needs a slug and must never get a page. The assignment needs dates and an employment status that mean nothing. Agency inclusion must ignore it.

### Option B: A virtual entry: records keep the agency and have no officer link (recommended)

- **Approach**: A record stores its agency and has no officer link when the officer is not identified. Arrests already store `agency_id`; reports gain `agency_id` in `supply-site-display-data`; civil cases gain a `civil_case_agency` link table for a case linked to an agency with no identified officer. Each such record gets an annotation saying the officer is not identified. A view, `agency_unknown_officer_record`, returns one row per agency and record kind with the records that have no officer link. The site shows that view as an "Unknown officer" entry.
- **Pros**: Nothing fictional is stored. Counts and personnel pages are right with no exclusions. The annotation reports the defect back to the source, which matches the owner's aim for annotations. Foreign keys stay exact: an officer link exists only when the source identifies the officer.
- **Cons**: Civil cases need a new link table, which changes the `agency-record-selection` rule. Records have two paths to an agency (direct, and through officer links), so a check must keep them consistent. "No officer link" must be distinguished from "officer link not yet imported"; the annotation does that.

### Option C: An assignment row with no person

- **Approach**: Like A, but the unknown-officer `agency_personnel` row has a null `personnel_id`, so no `personnel` row, slug or page exists.
- **Pros**: One path to the agency, like A. No fake person, so personnel pages and distinct-person counts exclude it with no extra rule.
- **Cons**: `agency_personnel.personnel_id` stops being required, which weakens a core invariant every query relies on. Assignment-level views (rosters, assignment counts, employment status) still need an exclusion. It is still a placeholder row.

## Agreed Approach

Not agreed. The owner chooses. The recommendation is Option B, for the reasons in `design.md`.

## Key Decisions

None yet. The choice-independent rules are in the spec: such records are kept and linked to their agency, they carry an annotation, they never count as staff, and a database view presents them.

## Open Questions

See `design.md`, section "Open Questions".
