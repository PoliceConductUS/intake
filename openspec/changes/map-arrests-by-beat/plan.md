# Arrest beat maps implementation plan

> Execute inline using executing-plans. Implementation approved; reuse active branches.

**Goal:** Named beat maps on personnel and agency pages only.
**Architecture:** Acquisition emits sanitized official boundaries; transform writes them once per agency profile. Personnel maps use that agency boundary evidence with their own counts. One map component provides persistent labels and accessible counts.
**Tech Stack:** TypeScript, Astro, existing Leaflet, PostgreSQL JSON.
**Spec:** specs/arrest-beat-maps/spec.md

## Global constraints

No private arrest points or identifiers in public output. No new dependencies or fallback contracts. Keep provenance and unmapped totals. No geographic rollups, reset, or publish.

## Review focus

Duplicate/missing boundaries; numeric beat names; multi-person bookings; unmapped arrests; no-JavaScript/mobile rendering.

## Tasks

- [ ] Test and implement boundary acquisition and transform propagation; run Irving source tests.
- [ ] Test and implement pure map count preparation; attach agency boundaries to personnel evidence.
- [ ] Render maps on personnel and agency pages only; verify labels, counts, and mobile/no-JavaScript access.
- [ ] Run types, lint, OpenSpec, focused tests and independent review; record import/live verification limits.
