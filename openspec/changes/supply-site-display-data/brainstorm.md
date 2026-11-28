## Design Summary

This brainstorm was not run as an interactive session. Its inputs are the owner's written decisions of 2026-11-19 to 2026-11-22 and the website audits made from them:

- `policeconduct.org` `.egm-reviews/owner-decisions-round1.md` (the dated decisions at the end are authoritative);
- `policeconduct.org` `.egm-reviews/site-decisions-inventory.md`;
- `policeconduct.org` `.egm-reviews/intake-corrections-queue.md`;
- `policeconduct.org` `AGENTS.md`, section "The Site Is A View Of The Database";
- website commit `84c5cec` ("remove content and relationship decisions from the site");
- the website build projection script `scripts/refresh-build-projections.mjs`, read-only;
- an owner addition of 2026-11-22: "where possible, move the selection rules and projections to the database", and, about public staff counts, "maybe the database needs stored procs, views or something else to make sure these counts are accurate based on the data and not some buried logic in the site".

The owner's rule: the website is a generated view of the database. It never filters, selects, connects, normalizes or decides page content. When a page needs a value or a connection, intake adds it to the database and fills it. Text standardization is intake's job, and every correction is recorded as a data annotation.

Commit `84c5cec` removed those decisions from the website. Pages now lose details until intake supplies them. This change supplies them:

1. New columns that hold facts the site used to derive: employment status, report agency, civil case status, phone kind, state code, administrative-area kind, deceased message.
2. Two manual-records tables for license actions: the exact source action texts and the small set of action types they collapse to, each with a category.
3. Annotation message codes: each annotation names a code; a manual-records table maps the code to a public message.
4. Text standardization of stored values, each change recorded as a correction annotation.
5. Database views for page selection, for foreign-key chains the site follows, and for every public count.
6. The website build projections (`build_page_payload`, `agency_zip_index`, `location_path_closure`) move into the database as views and materialized views owned by intake migrations.

## Alternatives Considered

### Option A: Columns only, the site keeps its selection queries and projection script

- **Approach**: Add the missing columns. Leave page selection, counts and `scripts/refresh-build-projections.mjs` in the website.
- **Pros**: Smallest intake change.
- **Cons**: Counts and selection stay "buried logic in the site", which the owner rejected on 2026-11-22. Each count is defined in several website loaders and can drift.
- **Why not chosen**: It does not meet the owner's addition.

### Option B: Intake writes a payload table during `data generate`

- **Approach**: A new intake stage computes page payloads and writes them as recorded mutations.
- **Pros**: The data lives in the mutation chain.
- **Cons**: Payloads are derived state, not source facts. Every count change becomes a chain entry. A reset replays thousands of derived rows. It mixes projection with evidence.
- **Why not chosen**: Derived rollups belong in SQL over the recorded rows, not in the evidence chain.

### Option C: Database views and materialized views defined in intake migrations (chosen)

- **Approach**: Facts the site used to derive become columns filled by intake through the normal envelope and mutation path. Selection rules, foreign-key chains, counts and page payloads become SQL views or materialized views in intake migrations. The build reads them.
- **Pros**: One definition per count and per rule. The definitions are checked in, reviewed, and testable against the database. The site only reads.
- **Cons**: More migration SQL. Materialized views need a refresh step. Some presentation work cannot move (listed in `design.md`).

## Agreed Approach

Option C. Facts are columns written only through envelopes and recorded mutations. Rules and counts are SQL in migrations. Materialized views are refreshed by one database function, `public.refresh_site_projections()`, that the website build calls where it calls its projection script today.

## Key Decisions

- Status columns hold reader-facing words with a `CHECK` constraint (for example `Current`, `Former`, `Unknown`). The site shows the stored word as stored.
- Manual records (license action texts and types, annotation messages, standard values) enter through the manual source `org/policeconduct/manual` (ADR 0031). Their IDs come from the source-name mapping. No migration hard-codes a data row ID.
- Annotation message codes reuse the message table proposed by the change `type-annotation-envelopes` (ADR 0038). This change adds the codes the corrections queue needs.
- The headline assignment is a database view (owner, 2026-11-22). Removing it in website commit `84c5cec` dropped the agency from personnel page titles, the profile hero, form prefills and schema.org `worksFor`; the owner called that a release-blocking bug. The site never selects the assignment; `site_personnel_headline_assignment` does (design D12).
- A phone order or primary flag is not needed: the agency page lists every phone. Only the phone kind is needed, so a fax number does not render as a call link.
- The arrest-profile link (`arrest_profile.agency_arrest_profile_id`) is not part of this change. The owner later replaced arrest profiles with a complete import of arrest records (change `import-arrest-records`).

## Open Questions

See `design.md`, section "Open Questions". They are repeated in the proposal's impact section only by reference.
