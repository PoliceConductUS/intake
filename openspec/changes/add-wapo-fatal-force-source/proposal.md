## Why

The Washington Post's **Fatal Force** database records every person shot and
killed by a police officer in the line of duty since 2015. It is the most
complete public account of that event class, and it is **final**: the v2 README
accepts only killings from 2015-01-01 through 2024-12-31, and the incident file
has not gained a row since. 10,430 incidents, closed.

The database cannot hold a fatal-shooting incident today. This change adds the
entity and the source that populates it.

Two things make a closed corpus worth ingesting:

1. **It is an outcome measure we otherwise cannot compute.** Every source we
   hold describes agencies, personnel, licensure, and discipline — inputs. This
   is the outcome those inputs are supposed to bear on.
2. **The agency reference file is independent entity-resolution evidence.** The
   Post's reporters reconciled agency names against FBI and DOJ sources and
   rolled sub-agencies, troops, regions, and posts up into parent agencies. That
   agency→ORI-*set* rollup is the problem federal censuses do not solve for us.

## What Changes

**New source `sources/org.washingtonpost.fatal-force/` (acquire + transform)**

- From: no fatal-shooting entity and no way to ingest one.
- To: `acquire.ts` downloads the two v2 CSVs **pinned to an upstream commit SHA**
  and preserves them with per-file sha256, byte length, URL, and retrieval time;
  `transform.ts` reads only the saved bytes and emits `FatalShootings` and
  `FatalShootingAgencies`.
- Impact: additive namespace `org.washingtonpost.fatal-force`; **two new tables**,
  and therefore a **generated type refresh**.

**New entity tables `public.fatal_shooting` and `public.fatal_shooting_agency`**

- Source-agnostic entities, not WaPo-shaped ones. A fatal shooting is a domain
  record any source could report; the reporting source is provenance, not schema.
- `fatal_shooting_agency` holds the agency **as the source reported it** —
  including its ORI codes verbatim — with a **nullable** `agency_id` populated
  only when that agency actually resolves to one we already hold.

**Redistribution class on the source**

Fatal Force is published under **CC BY-NC-SA 4.0**. ShareAlike (§3(b)) attaches
when Adapted Material is **Shared**; the constraint therefore binds at
publication and bulk export, not at ingestion. This change records
`redistribution_class: noncommercial_sharealike` so the public API and bulk
export can exclude the source **structurally** rather than by anyone remembering
to. Without that tag the first export ships the problem.

## Affected Migrations, Seed Rows, and Downstream Contracts

- **Migrations:** one additive migration creating the two tables. No existing
  table is altered.
- **Seed rows:** none. Every row arrives through the data chain, never
  `seed.sql`, so no post-seed integrity assertions are added by this change.
- **Generated contracts:** ADR 0025 binds — both tables' models MUST come from
  `npm run generate:envelope-types` introspecting a live schema. **This change
  cannot be completed without a running Postgres** (`supabase start`, i.e.
  Docker). No hand-written row or spec type may stand in for the generated one.
- **Data reset:** not required. The tables are additive and start empty.
- **Production migration plan:** standard additive migration — no backfill and no
  rewrite of existing rows.
- **Downstream app contracts:** unchanged. Nothing from this source renders on a
  public page under this change; see the publication boundary in `design.md`.

## Out Of Scope

- A canonical `agency.ori` column. ORI enters here only as source-reported text
  on the reported-agency record. Promoting ORI to a canonical agency identifier
  is a separate change and a separate argument.
- Creating agencies from this source. The agency file carries no address, and
  `AgencyCreateSpec` requires `location_path_id` + latitude + longitude + slug —
  from `{name, state}` alone, preparation throws. See `design.md`.
- Publishing any decedent-level record.
