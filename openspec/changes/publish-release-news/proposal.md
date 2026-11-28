## Why

News discovered between builds should reach the relevant personnel and agency pages and remain available after a later build. Submission processing also needs to identify the exact release that generated a form.

## What Changes

- The daily Intake Action searches Google All organic results through SerpApi for up to five distinct eligible terms per Chicago day. It ranks personnel query/profile pairs by impressions, waits at least seven days before searching a term again, and links the first qualifying current story. The full agency and officer sweep is outside this change.
- Link articles through officer-at-agency assignments. Keep the source that supports each assignment so personnel and agency pages can cite the coverage that connects them. Keep saved records and extracted article bodies private.
- Show up to 25 distinct homepage stories ordered by combined seven-day clicks for matched search terms and personnel landing pages. Use the preferred source to select and display each profile’s newest story. Measure changes in average search position around publication.
- Publish release-specific source HTML and a snapshot of existing agencies, personnel assignments and page paths.
- Consume page data keyed by replaceable part and serve a complete regenerated document at the existing canonical path.
- Preserve originating-form release identity in production and preview submissions.
- Use normalized publisher URLs as Daily article source IDs. Write confirmed duplicate-to-target URL pairs under `CoverageLink` in private `data/alias.json`. Keep persistent source IDs for assignment links. Carry the originating namespace and source ID in JSON and HTML across searches. Describe the cross-repository contract here. Intake owns its source, database and mutation changes.

## Capabilities

### New Capabilities

- `release-page-updates` covers the website release, saved page parts, rendering and originating form identity.

## Impact

Affected consumers are readers, forms, website hosting and the Intake publisher/importer. Existing article and assignment IDs remain stable. No conclusions about an officer or agency follow from the presence of a link.
