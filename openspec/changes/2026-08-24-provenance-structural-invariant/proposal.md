## Why

We publish claims about named human beings. Being wrong is a legal and ethical
catastrophe.

The current schema cannot cite itself. Across all 146 KB of migrations,
`provenance` appears 0 times, `citation` 0, `retrieved_at` 0, `attribution` 0.
`source_url` exists only on `civil_cases`; `confidence` only on
`coverage_links`. The two tables behind 99.7% of the public page surface --
`officers` and `agency_officers` -- carry no source, no retrieval date, and no
confidence. A blanket footer disclaimer stands in for per-field citation.

A convention would not fix this. A field-level `source_url` column is a
convention: nothing stops a template from selecting the value and omitting the
column. This change makes an uncited render structurally unreachable.

There are two secondary defects the same change must fix, because both are
join-key problems and fixing them later is a backfill against a live corpus:

- **ORI is absent.** `ORI` appears 0 times in the migrations. Agencies are
  keyed on a generated cuid2 with a 6-hex slug suffix that no external dataset
  shares. There is no join key to FBI/BJS data and no safe way to merge a
  second state's roster without fuzzy name-and-address matching.
- **Entity resolution is unmodeled.** `officers` has no aliases, no
  cross-agency linkage, and no identity confidence. Every sampled agency page
  shows "Past employers 0". Officers who moved between departments -- the
  single most important pattern in police accountability -- are currently
  modeled as unrelated people.

## What Changes

**Provenance Invariant**

- From: Displayable values are plain columns on `agency`, `officers`, and
  `agency_officers` with no source attribution.
- To: Displayable values are `public.claim` rows carrying a NOT NULL
  `retrieval_id`, and a retrieval cannot exist without a source, a retrieval
  timestamp, and either a source URL or a records-request identifier.
- Reason: An uncited value must be unrepresentable, not merely discouraged.
- Impact: New tables; no existing table is altered or dropped.

**Render Isolation**

- From: The page-build path reads base tables directly.
- To: A `render` schema exposes value and citation as a single indivisible
  `cited_value` jsonb. A `page_renderer` role holds SELECT on exactly two
  views and on nothing else.
- Reason: Row-level provenance alone is bypassable by selecting the value
  column and dropping the citation. Removing the renderer's ability to read
  any table containing an uncited value closes that path.
- Impact: New schema, new role, new least-privilege grants. Existing render
  paths are unaffected because they connect as a different role.

**Publication Status And Suppression**

- From: No publication lifecycle; a record is live or absent.
- To: `staged` / `published` / `blocked` / `quarantined` on every claim and
  employment period, subject-level suppression, and a trigger-written
  append-only `publication_event` audit trail.
- Reason: Correction and takedown must be possible on day one, and `blocked`
  (a policy decision) must be distinguishable from `quarantined` (a data
  quality decision) because they escalate to different people.
- Impact: New tables and triggers.

**Canonical Agency Identity**

- From: No ORI.
- To: `agency_ori` with an explicit `ori_form` (`ori7` / `ori9`), a generated
  `ori7` bridge key, an `agency_entity` layer above the reporting-unit layer,
  a reviewed `ori_conflict` queue, and explicit `agency_registry_presence`.
- Reason: ORI is a reporting-unit key, not a department key -- the FBI
  registry returns 148 agencies typed `State Police` for California and 1 for
  Texas. Federal datasets mix 7- and 9-character ORIs, so an unlabeled `ori`
  column silently fails to join, and a silent join failure here means a page
  about the wrong department.
- Impact: New tables; `agency` is referenced but not altered.

**Personnel Identity Resolution**

- From: `officers` rows with name columns and no linkage.
- To: An attribute-free `person` hypothesis, cited `person_name_variant` rows,
  `employment_period`, and confidence-scored `person_identity_link` records
  that are never merges.
- Reason: A wrong merge attributes one officer's misconduct to a different
  human being, and is irreversible. A link is reversible.
- Impact: New tables. `person.legacy_officer_id` attaches the existing corpus
  without rewriting it.

## Capabilities

### New Capabilities

- `provenance-invariant`: Structural enforcement that a displayable value
  cannot exist or be read without its citation, plus publication status,
  suppression, and audit trail.
- `canonical-agency-identity`: ORI-keyed agency identity, form-aware joins,
  the department-level entity layer, the reviewed conflict queue, and registry
  presence.
- `personnel-entity-resolution`: Confidence-scored, reversible personnel
  identity linkage across agencies and name variants.

### Modified Capabilities

- None. This change is purely additive.

## Impact

Affected areas:

- `supabase/migrations/20260824170000_provenance_structural_invariant.sql`
  (new, additive).
- `scripts/assert-provenance-invariant.ts` and the `assert:provenance` npm
  script, for CI enforcement after migrations.
- `test/schema/provenance-invariant.test.ts` and
  `test/schema/upstream-fixture.sql`, requiring `TEST_DATABASE_URL`.
- No generated type refresh is required: no existing table changes shape.
- No data reset is required. No production migration plan is requested by this
  change; applying it to production is deliberately a separate decision,
  because the backfill of 132,109 live personnel pages onto the claim model is
  a separate change with a legal dimension (see INS-11).

## Out Of Scope, Deliberately

- **Backfilling the existing corpus onto the claim model.** The live corpus has
  no retrieval records to point at. Manufacturing a citation for a value whose
  origin we cannot demonstrate would be worse than having none.
- **Retiring the legacy value columns** on `agency`, `officers`, and
  `agency_officers`. They stay until the backfill lands; the renderer simply
  cannot read them.
- **Opening the personnel gate.** `render.published_person` is defined to
  return zero rows and is not granted to `page_renderer`. Both locks must be
  removed by an explicit, reviewable migration, and only after Data Integrity
  & Publication Risk Reviewer clearance.
