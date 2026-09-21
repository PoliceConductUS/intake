# Census local jurisdictions implementation plan

**Goal:** Include missing local jurisdictions without duplicate PLACE coverage or changed existing URLs.
**Spec:** specs/artifacts-database-import/spec.md and design.md.
**Architecture:** Extend Census acquisition and transform, add a pure supplemental geography builder, record resolution class and enforce approved containment order.

## Source pipeline

- [x] Extend test/sources/us-census-gazetteer/{discovery,inputs,transform}.test.ts to assert COUSUB and CONCITY source coverage. Run `npx vitest run test/sources/us-census-gazetteer` and observe missing behavior.
- [x] Add supplemental-places.test.ts for Alba, exclusions, polygon subtraction, full coverage by a union, missing county, and same-name distinct city/township.
- [x] Extend roles.ts, inputs.ts, acquire/{discovery,download}.ts for same-vintage COUSUB and CONCITY paths. Use the seven-state CONCITY inventory verified against the Census directory rather than assuming every state has a file.
- [x] Implement lib/supplemental-places.ts using canonical geometry reader, class codes, COUNTYFP parent and polygon difference. Append paths and geometry using the existing geometry packaging stage; write an inspectable JSON report with original source identity and clipping outcome.

## Resolution

- [x] Extend place-snap.test.ts: primary+township -> primary; township-only -> township; two primary+township -> error. Observe failures before resolver edits.
- [x] Add additive migration location_path.resolution_class with primary default and checked primary/county_subdivision/consolidated_city values. Generate contracts against a disposable fully migrated database.
- [x] Include class in database point reads, select first nonempty class in resolver, update cache policy and ADR 0024.

## Verification

- [x] Run source and resolver tests to green, then all tests, typecheck and build.
- [x] Use a real PostGIS database for actual ST_Covers, migration/default and constraints; leave user database intact.
- [x] Verify Alba with real TIGER COUSUB and existing source PLACE data; confirm existing paths unchanged.
- [x] Run OpenSpec validation and scoped formatting, write verify.md with commands and limitations, then commit only these changes on redesign.
