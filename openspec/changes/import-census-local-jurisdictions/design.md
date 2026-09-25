# Design

Extend the existing namespace, without creating another branch or changing path hierarchy. Read COUSUB attributes and geometry directly from TIGER (Gazetteer alone does not identify the legal/statistical class). Use authoritative county GEOIDs for subdivisions, and existing area-overlap logic for consolidated cities. Preserve NAMELSAD for supplemental path labels to distinguish townships, towns and consolidated governments from same-named PLACE features. Keep existing PLACE output stable.

Use polygon difference against intersecting PLACE polygons to prove full coverage before skipping a subdivision; partial coverage emits the full original Census polygon. The difference result is used only to determine whether coverage is complete, never as an emitted boundary. Never infer equivalence from a name. Emit an ordinary JSON coverage report (not a YAML envelope) with every included/skipped supplemental GEOID and reason.

Record `resolution_class` on location_path with primary as the database default for existing location rows. Supplemental rows explicitly use county_subdivision or consolidated_city. Select by that class only among actual ST_Covers matches; fail ties. Subdivision geometry retains its original Census boundary; class precedence resolves overlap with PLACE boundaries. No name or nearest-place substitution.

User approved excluding statistical divisions, preferring PLACE over township, and skipping fully PLACE-covered townships, and retaining the full original Census boundaries of the remaining townships. Consolidated cities are broader municipal coverage and follow subdivisions in resolution priority. Existing 50 states plus DC scope excludes territorial subminor civil divisions. No separate tribal-reservation, service-area, or land-use dataset is added. Legally independent tribal-area county subdivisions (Census class Z2) are included as local jurisdictions through COUSUB.

References: [Census class codes](https://www.census.gov/library/reference/code-lists/class-codes.html), [COUSUB files](https://www2.census.gov/geo/tiger/TIGER2025/COUSUB/), [CONCITY files](https://www2.census.gov/geo/tiger/TIGER2025/CONCITY/).
