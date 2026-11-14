## Why

Reports currently store civil-case URLs as generic external evidence links. This duplicates the case URL and title and incorrectly opens an internal case in a new tab.

## What Changes

Store the case identity on the existing report link as `review_links.civil_case_id`. Case links use the referenced case title and slug, and render as ordinary internal links. Convert the requested Irving link through the manual intake source and recorded mutations, preserving its ID.

## Capabilities

### New Capabilities

- `report-case-links`: Database-backed report links to civil cases.

## Impact

Add an optional case foreign key and permit null URL/title for case links. Regenerate intake envelopes and dependency metadata. Update the website schema contract, report loader, and report template. No reset or new dependency is required. External evidence links retain their existing behavior.
