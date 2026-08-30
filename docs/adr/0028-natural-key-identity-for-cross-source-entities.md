# ADR 0028: Natural-Key Identity for Cross-Source Entities

## Status

Accepted

> Adds a third identity strategy alongside the two ADR 0023 already defines
> (minted-cuid via the ledger; referenced-cuid via `sourceIdFor`). Introduced for
> civil-case entities (`CivilCase`, `CivilCasePersonnel`, `CivilCaseLink`), which
> are produced independently by more than one source.

## Context

Most entities have no identifier shared across sources. A tcole agency
(`DEPARTMENT_NUMBER`), an mn-post agency (a Salesforce id), and a clearinghouse
agency are the same real agency under three unrelated keys, so their canonical id
must be a minted cuid and convergence happens by _reference_ — a later source is
handed the existing canonical id for an entity it did not create (ADR 0023).

Civil cases are different in two ways:

1. **They are created by multiple sources.** The Civil Rights Litigation
   Clearinghouse (CH) and CourtListener (CL) each independently produce a case for
   the same lawsuit. Neither references the other; both create. Reference-based
   convergence does not apply — there is no prior canonical id to hand out.
2. **They have a universal natural key.** The court assigns a docket number
   (`3:16-cv-03089`), scoped to a court. `(court, docket_number)` uniquely
   identifies a docket across every source. (A docket number alone does not — the
   office prefix is court-relative, so two districts can share one.)

Minting a cuid and maintaining a `natural-key → cuid` registry to converge CH and
CL would work, but the registry is pure indirection when a real, stable key
already exists. And the same convergence must reach the children: if CH and CL
both name the same officer in the same case, or both attach a link, those
`CivilCasePersonnel` / `CivilCaseLink` rows must converge too, or a deduped case
still carries duplicate children.

## Decision

For entity kinds that are produced by multiple sources and have a universal
natural key, **the canonical id _is_ the normalized natural key** — a
deterministic function of the entity's identifying attributes, not a minted cuid
and not a source-scoped id. Two sources compute the same id independently and
converge with no registry and no coordination; the database primary key is the
meeting point (the second source to import finds the existing row and updates it).

This is registered per kind as an identity strategy in the resolver registry,
next to the existing minted/referenced strategies.

### Civil-case identity

```
CivilCase.id          = `${court_id}:${normalized_docket_number}`
CivilCasePersonnel.id = `${civil_case_id}|${agency_personnel_id}`
CivilCaseLink.id      = `${civil_case_id}|${normalized_url}`
```

- **`court_id`** is CourtListener's court token (`txnd`, `ca5`, `scotus`). CL
  carries it natively. CH carries a `recap_link` to the CL docket on ~87% of
  dockets, from which `court_id` is read exactly; the rest fall back to a small,
  finite CH-court-name → `court_id` table.
- **`normalized_docket_number`** is the PACER docket string lowercased and
  trimmed. CH's `docket_number_manual` and CL's `docket_number` are already the
  same string, so normalization is light.
- A child's id is composed from its **resolved** (canonical) foreign keys plus its
  own distinguishing attribute, so children converge exactly when their parents
  do. This makes a child's identity depend on its FKs being resolved first — a
  legal ordering, since neither FK depends on the child's identity.

### The safety invariant

The id is built only from real identifiers (court + docket number), never from
fuzzy fields (title, party names). A normalization error can therefore only
**fail to merge** two records of the same case (a duplicate) — it can never
**merge two distinct cases** (data corruption). Missed merges are recoverable;
wrong merges are not. This is what makes a computed key safe as a primary key.

### Cases without a natural key

A civil case with no docket number (some state cases; CH is the only state source,
CL is federal-only) still gets a normalized-natural-key id from whatever
identifiers it has (`state`, court, case number) on a best-effort basis. Because
such cases come from a single source, a weak key costs nothing — there is no
second source to converge with.

## Consequences

- `CivilCase`, `CivilCasePersonnel`, and `CivilCaseLink` become deliberate
  exceptions to the "canonical id is a minted cuid" model, justified by having a
  real universal key. Their ids are human-readable and reproducible across runs
  and machines with no shared ledger state.
- No new state infrastructure: no `natural-key → cuid` registry, no cross-source
  coordination. Convergence is a property of the data plus the database primary
  key.
- The CH acquire must fetch each case's dockets (it previously fetched only the
  case record) and emit **one `CivilCase` per docket**, matching CL's docket-level
  model and the single-`court`/`cause_number` schema.
- The normalization functions (`court_id` resolution, docket-number
  normalization) become an identity contract: changing them changes primary keys,
  so they evolve only via an explicit id migration.
- Merge policy for the shared row (whose `title`/`claims_summary`/`court` wins
  when the second source updates) is a separate, field-level decision this ADR
  does not settle.
