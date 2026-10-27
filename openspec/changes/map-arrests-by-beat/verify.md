# Verification

## Scope

Maps are wired only to personnel and agency pages. Geographic rollups remain deferred. Original income changes and unrelated dirty work remain intact.

## Evidence

- Irving source tests: 31 passed across five files.
- Real source reacquisition succeeded: 41,211 bookings, 179,916 source charge rows, and 26 patrol boundaries; original evidence preserved. Database writes were not performed.
- Website focused map/income tests: eight passed. Tests cover count reconciliation, missing/duplicate boundaries, concave polygons, holes/multipolygons, permanent labels, non-overlap at desktop/mobile widths, and no-JavaScript count access.
- Full 26-boundary map visually inspected at 1280px and 390px with explicitly synthetic counts. Initial crowded labels were corrected with compact labels and connectors.
- Independent review found bbox anchors outside their beats; replaced them with polygon interior points. Independent winding-number validation of the corrected anchors: 26 valid, zero outside. No remaining reviewer blocker.
- Website typecheck: zero errors, zero warnings, three existing hints. Scoped ESLint/format/whitespace checks pass.
- OpenSpec: intake 49 items passed; website 26 items passed.

## Limits

The local database currently has zero agency and personnel arrest profiles, so actual personnel/agency page validation awaits restoration/import. The full website suite was already not green against this incomplete database; it was not used to claim map completion.

Intake build/typecheck remain blocked by existing SourceNameToCanonicalIdLedger.readSourceName errors in unchanged cache code/tests. No fixes to that unrelated contract were attempted.

No database reset, migration, deployment, commit, or push was performed.
