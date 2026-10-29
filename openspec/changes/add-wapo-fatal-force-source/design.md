## Context

### Verified facts about the upstream corpus

Measured against the v2 files at upstream commit `cb0fb99`, retrieved
2026-10-25:

| Fact | Value |
|---|---|
| Incident rows | 10,430 |
| Date range | 2015-01-02 → 2024-12-31, zero unparseable dates |
| Distinct `id` | 10,430 (equal to row count — `id` is unique) |
| `id` range | 3 – 11,295 (sparse; gaps are retracted or merged records) |
| Agency rows | 3,727 |
| Agencies with >1 ORI | 96 |
| Agencies with **no** ORI | 132 |
| `name` (decedent) populated | 97.0% |
| `race` populated | 88.6% |
| `agency_ids` populated | 100% |
| `fatal-police-shootings-data.csv` | 1,861,881 B, sha256 `606745b7…` |
| `fatal-police-shootings-agencies.csv` | 284,808 B, sha256 `45d59f37…` |

**The corpus is closed.** Upstream commit `2025-08-25` is titled *"Update README:
only killings 2015-2024 are accepted"*, the last data commit is 2025-06-17, and
the maximum incident date is 2024-12-31. Later upstream commits touch
documentation. Design for a **final** dataset, not a feed.

### Verified pipeline constraints

- `AgencyCreateSpec` requires `location_path_id` + `latitude` + `longitude` +
  `slug`. From `{name, state}` alone preparation **throws**
  (`enrich-agencies-osm-ori/design.md`). The Fatal Force agency file carries
  `name`, `type`, `state`, `oricodes`, `total_shootings` — **no address**.
- `scripts/lib/schema-introspection.ts` introspects a **live** database and is
  scoped to `table_schema = 'public'`. New persisted models come from the
  generator or they do not exist (ADR 0025).

## Decisions

### D1 — Two source-agnostic entities, not a WaPo-shaped table

`public.fatal_shooting` is the incident. `public.fatal_shooting_agency` is the
agency **as reported by the source that reported the shooting**. Neither is named
for, or shaped by, The Washington Post. AGENTS.md forbids source-ID-specific
special cases; a second source reporting fatal shootings must land in the same
tables with different provenance, not a parallel table.

### D2 — Identity is a minted canonical ID via the source-name ledger, not a natural key

ADR 0028's natural-key strategy applies to entities **produced by multiple
sources** that share a **universal** natural key. A fatal shooting today has one
producer, and the WaPo `id` is a source-internal integer with no meaning outside
that file. So identity follows ADR 0008/0023: namespace + record kind +
source-local name (`id`) → minted cuid2 through the durable ledger. The source
does not mint canonical IDs.

**Revisit trigger:** if a second source begins producing fatal shootings and a
universal natural key exists for the event, re-evaluate against ADR 0028.

### D3 — ORI is recorded as an attribute, never as a key

96 of 3,727 agencies carry more than one ORI and 132 carry none. ORI is therefore
**not a function of agency** in this dataset — it is a reporting-unit identifier,
not a department identifier. It is stored verbatim as source-reported text on
`fatal_shooting_agency`. It is not a primary key, not a join key, and not
promoted onto `public.agency` by this change.

This is the empirical confirmation of the agency→ORI-*set* problem: the data
says one agency may legitimately carry several ORIs, so any schema that assumes
ORI is unique per agency is wrong before it ships.

### D4 — This source never creates an agency, and never guesses one

`fatal_shooting_agency.agency_id` is **nullable**. It is populated only when the
reported agency resolves to an agency we already hold, through the existing
resolver, with the resolution recorded as a resolved property. It is left null
otherwise.

Two independent reasons, either sufficient:

1. **Mechanically impossible.** No address means no `location_path_id` or
   coordinates, so `AgencyCreateSpec` preparation throws.
2. **Wrong even if it were possible.** Matching 3,727 agency names to our corpus
   by `{name, state}` is a fuzzy match over named real organisations. An
   unresolved record preserved as unresolved is correct; a plausible-looking
   wrong match is a false claim about a real agency.

### D5 — Provenance is file-level and pinned (ADR 0005)

`acquire` pins an explicit upstream **commit SHA** rather than fetching
`master`, so inputs are reproducible and an upstream change surfaces as a
changed pin rather than as silently different bytes. For each file it preserves
the original bytes unmodified plus `sourceUrl`, `commit`, `sha256`,
`byteLength`, and `retrievedAt`.

`transform` reads only saved inputs — no network, no wall-clock, no randomness.
The same input bytes produce the same manifest.

### D6 — Idempotency is comparison, not skipping

Re-running against the same pinned commit produces identical records, which the
existing generate/up chain resolves to a no-op **after comparison**. Per
AGENTS.md this change adds no `ON CONFLICT`, no `upsert: "read"`, and no
existence-only skip. A changed upstream pin must produce a visible diff or a
loud failure — never a silent skip.

Because the corpus is closed, the expected steady state is an empty diff
forever. That is a property to assert, not to assume.

### D7 — The publication boundary lives at the projection layer, not the database

The database is not a public surface; pages are **generated from** it. The
control that matters is therefore the one between a stored row and a rendered
page — the rendered-field diff and suppression at the projection layer — not a
schema-level grant.

Under this change **nothing from this source renders on any public page.** The
only cleared output is the aggregate annual count (ten integers naming nobody),
which is a board decision recorded on INS-81. Decedent-level records remain
unpublished pending an adopted named-decedent rule.

`redistribution_class: noncommercial_sharealike` is the structural hook: the
public API and bulk export filter on it, so a CC BY-NC-SA source cannot reach an
open export by omission.

### D8 — Contested attributes are stored as source claims

`threat_type`, `flee_status`, `armed_with`, `was_mental_illness_related`, and
`race` are inferences The Post drew from news reports and official statements
about people who cannot correct the record. They are stored as **attributed
claims of the source**, with `race_source` preserved as the source's own
provenance for `race`. This change never upgrades them to canonical facts about
a person.

## Risks And Open Questions

- **The agency file's value is realised only on resolution.** Until agencies
  resolve, the ORI rollup sits unused. That is the honest sequencing: store the
  evidence now, resolve when a resolution path worth trusting exists, never by
  fuzzy match in the meantime.
- **~3% of incidents have no decedent name.** They are ingested as complete
  records with an absent name, not dropped — absence is evidence.
- **`total_shootings` is a source-computed aggregate.** It is stored as reported
  and never recomputed from the incident file. If the two disagree, that
  disagreement is signal about the source and must surface rather than be
  harmonised.
