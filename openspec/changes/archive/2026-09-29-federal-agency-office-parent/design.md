## Context

The removed join table allowed at most one federal parent per agency. A nullable
foreign key on Agency represents that same cardinality without a separate record.

## Decisions

Add an indexed `parent_federal_agency_id` referencing `federal_agency.id`. Keep
ordinary agency IDs, slugs, location paths, and address coordinates. Source offices
emit the federal source name in this field; existing FK metadata and source-name
mapping resolve canonical IDs before writing. Derived FK resolvers read nullability
from the generated create spec; nullable references permit absence without a
field-specific override, while required references continue to fail when missing.
An omitted optional FK emits no write; an explicit null clears the relationship.
A later roster source therefore cannot erase a parent it does not supply.

Declare a directed edge from FederalAgency to Agency through the parent field.
Derive independent root kinds from the shared graph: kinds without an incoming
inclusion edge are roots. Do not add a per-kind root allowlist or selection branch. Existing generic ancestor reads
and graph traversal serve every source. Other agencies retain current eligibility.

Use an additive migration after the already-applied table removal. No old migration
is rewritten and no branch compatibility envelope is retained. Re-transform the
preserved source state, generate a delta, inspect it, and apply only that delta.

## Validation

Regressions cover new and existing offices without open assignments/cases, retained
agency identity, unrelated agencies staying excluded, and later imports reading a
stored federal parent. Exercise the full migration chain in disposable PostgreSQL,
then apply locally and verify all 11 offices have valid parent references.

## Initial import run

The user approved applying saved initial agency lists throughout the first import
run. Reset passes the initial-root decision explicitly through nested commands.
Update checks emptiness once before its source loop; each generation receives the
same decision. Standalone generation retains its existing empty-table check.

Federal parent records already come from the curated `federal-agencies.yaml` state
file. Existing acquisition retains this list and writes new candidates separately.
Keep these fixed reference rows in their existing curated source and resolve
parent rows before offices through normal FK dependency order.
