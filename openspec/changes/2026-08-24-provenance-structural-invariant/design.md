# Design — Provenance As A Structural Invariant

## The requirement, restated precisely

"A field without provenance does not render" is two separate claims, and each
needs its own mechanism:

1. An uncited value must not be able to **exist**.
2. An uncited value must not be able to be **read by the render path**.

Implementing only (1) leaves a convention: the value column is still selectable
without the citation column. Implementing only (2) leaves a hole: the render
path could be pointed at a base table. Both are required.

## Mechanism 1 — existence

Displayable values live in `public.claim`, whose `retrieval_id` is `NOT NULL`
and references `public.source_retrieval`. That table has:

```sql
constraint source_retrieval_locator_required check (
    source_url is not null or records_request_id is not null
)
```

so a retrieval cannot exist without a locator, and `retrieved_at` is `NOT NULL`.
`source_retrieval` is append-only by trigger, so a retrieval date cannot be
rewritten after the fact — a mutable citation date is a falsifiable citation.

`confidence` is `NOT NULL check (confidence > 0 and confidence <= 1)`.
Zero is excluded deliberately: a claim we assign no confidence to is not a
claim, it is a deletion.

The four required provenance elements therefore reduce to: source dataset
(`source` via `source_retrieval`), retrieval date (`source_retrieval.retrieved_at`),
source URL or records-request identifier (`source_retrieval`, constrained), and
confidence (`claim`). None is nullable.

### Why predicates are registered

`claim.predicate` references `claim_predicate`. Adding a displayable field
requires adding a registry row declaring its datatype, whether it is
`renderable` at all, and how many independent sources must corroborate it.
This makes "a new field appeared on a public page" a reviewable schema change
rather than a template edit.

The live case that forced `renderable = false`: `agency_type_name` is
internally inconsistent across states (148 California agencies typed
`State Police`, 1 in Texas). It is ingested with provenance, drives internal
grouping, and cannot be published until a second source corroborates it.

### Why `value_absent` exists

39% of Texas rows (686/1,754) and 27% of California rows (237/867) in the
federal registry have null lat/lon. "The source does not record this" is a
fact with a citation, and it is not the same as "we have not asked". A
`value_absent` claim renders as a cited absence. Enrichment from another
source becomes a second claim from a second retrieval and never overwrites the
registry value in place.

## Mechanism 2 — reading

`render.published_claim` exposes exactly four columns:

```
subject_type, subject_id, predicate, cited_value
```

There is no `value_text`. `cited_value` is a jsonb built by `render.cite()`
containing `{value, absent, citation{source, sourceName, publisher,
retrievedAt, locator, locatorType, confidence, confidenceBasis}}`. The value
and its citation are the same column, so no projection can separate them.

The view INNER JOINs `source_retrieval` and `source`, filters
`publication_status = 'published'`, excludes superseded claims, excludes
non-renderable predicates, excludes sources whose terms are not `cleared`, and
excludes suppressed subjects.

The page build connects as `page_renderer`, whose entire privilege set is:

```
render.published_agency [SELECT]
render.published_claim  [SELECT]
```

Verified: as `page_renderer`, `select count(*) from public.claim` returns
`ERROR: permission denied for schema public`. There is no SQL that role can
write which returns a value without its source, because it cannot reach any
table that holds one.

`alter default privileges in schema render revoke all on tables from
page_renderer` means a future render view is unreadable until someone writes
an explicit grant.

## Mechanism 3 — the invariant does not decay

An invariant enforced only by the migration that created it lasts until the
next migration. `public.assert_provenance_invariant()` returns violations and
is wired to `npm run assert:provenance` for CI. It detects:

- any `page_renderer` privilege on a table outside `render`
- any `page_renderer` privilege on a `render` object outside the reviewed
  allowlist — this is what catches a future `grant select on all tables in
schema render`
- the personnel gate being opened by a grant
- any render view exposing a bare value column

## Agency identity

ORI is the primary agency key because it is the one identifier federal, state,
and local datasets share. Two measured facts shape the model:

**ORI is a reporting-unit key, not a department key.** The FBI registry returns
148 agencies typed `State Police` for California; California has one
state-police equivalent. Those are CHP area offices, each holding its own ORI.
Without a layer above ORI, CHP renders as 148 separate police departments.
`agency_entity` is that layer, and `agency_entity_member` records membership
with a confidence and an evidence payload — agency-side entity resolution is a
first-class problem, not only a personnel-side one.

**ORI form varies across datasets.** All 1,754 Texas ORIs from the federal
registry are 9 characters; older federal datasets use 7. `ori_form` is
recorded explicitly and length-checked. `ori7` is a `generated always ... stored`
bridge key so it cannot drift, and is documented as derived so nobody mistakes
it for a source-asserted identifier. Two ORIs sharing an `ori7` are
_candidates_ for the same unit — never an automatic merge.

**Conflicts queue, they do not resolve.** A trigger on `agency_ori` opens an
`ori_conflict` row when an `ori7` maps to more than one agency or to more than
one form. `render.published_agency` excludes any agency with an open conflict:
an unresolved ORI collision means we may be about to publish a page about the
wrong department, and accuracy outranks coverage. Closing a conflict requires
a resolver, a timestamp, and a note, enforced by constraint.

**Absence is a finding.** The federal source is a UCR-_participation_ registry,
not the NCIC ORI universe (the real NCIC file is CJIS-restricted and we will
not have it). Puerto Rico returns 1 agency; PR has a state police force plus
dozens of municipal departments. `agency_registry_presence` records
`present` / `absent` / `not_applicable` / `unknown` per source per retrieval,
so "not in the registry" can never be silently read as "does not exist" and
INS-7 coverage denominators are never a registry row count.

## Personnel identity

`person` has no attribute columns at all — only `person_id`,
`legacy_officer_id`, and timestamps. This is deliberate and is verified by a
test: there is no `person.first_name` that could ever render uncited. A
person's name exists only as `person_name_variant` rows, each with its own
retrieval and confidence.

`person_identity_link` records assertions between two person rows and never
merges them:

- `assertion` is `same_person`, `possible_same_person`, or `distinct_person`.
  The negative is as valuable as the positive: a reviewed `distinct_person`
  stops the same false candidate being re-proposed on every run.
- The pair is canonically ordered (`person_id_a < person_id_b`), so a pair is
  unique in one direction only.
- Any non-`proposed` status requires a reviewer and a timestamp.
- An automated probabilistic method may not self-accept a `same_person` link.
  Only `manual_review` and `state_certification_number` may.

The measured reason for this caution: 116,020 distinct personnel name-slugs
are live, 7,909 of which have more than one profile — 13,914 profiles beyond
one-per-name. `jose-gonzalez` has 33. That is not evidence of error; there
really are many officers by that name. It is evidence that ~14k profiles sit
exactly where entity resolution either works or produces a catastrophic
outcome: wrongly merging two officers, or wrongly splitting one officer's
career so misconduct does not follow them across departments.

A link is reversible. A merge is not. We link.

## Rejected alternatives

**Per-column `source_url` / `retrieved_at` on existing tables.** Smaller
migration, and it is a convention — a template can select `name` and never
touch `name_source_url`. It also cannot represent two sources disagreeing
about one field, which is the normal case here, not the exception.

**Application-layer enforcement (an ORM guard or a lint rule).** Both are
developer discipline. The instruction was explicitly that this must not be.

**Row-level security instead of a separate role.** RLS filters rows; it does
not prevent selecting a value column without its citation column. The
column-shape guarantee is what makes the citation inseparable, and that comes
from the view definition, not from RLS.

**Hard-merging duplicate officers.** Irreversible, and the failure mode is
attributing one human's misconduct to another.

## Known limits

- **The existing 132,109 personnel pages are not covered by this change.** They
  have no retrieval records to point at. This change makes the correct model
  exist; it does not retroactively cite a corpus whose origin we cannot
  demonstrate. That is INS-11's decision and a separate change.
- **`security_invoker = off`** means the render views read base tables with
  their owner's rights. That is what lets `page_renderer` hold no privilege on
  `public`. The tradeoff is that the view definitions are themselves
  security-critical and must be reviewed as such.
- **Verified against a fixture, not the full 45-table schema.** PostGIS is not
  available on the verification host, so the full migration set could not be
  applied locally. `test/schema/upstream-fixture.sql` reproduces only the
  upstream objects this migration references (`generate_cuid`, `agency`,
  `officers`) and is skipped when `public.agency` already exists. The suite
  must also be run against a real `supabase db reset` database before merge.
