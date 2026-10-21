# Add officer reporting spreadsheet source

## Why

The supplied Google spreadsheet identifies officers and links to reporting, but
does not identify their employing agencies. Intake needs article-supported
agency identities to associate that coverage with specific existing officers.

## What Changes

- Preserve the original spreadsheet and each linked article's retrieval result.
- Preserve spreadsheet rows and hyperlink targets, including investigation-only
  links, without treating the spreadsheet's allegation labels as findings.
- Record reviewed officer names, agency names, and supporting article passages.
- Resolve those identities through shared intake resolvers and emit existing
  CoverageLinks and CoverageLinkAgencyPersonnel artifacts.
- Report inaccessible articles and unresolved identities explicitly.

## Impact

One new source module and saved evidence. Restore the two already-applied
migration files (`20261006000000_agency_arrest_profile.sql` and
`20261010000000_personnel_photo.sql`) from the existing Oregon worktree after
comparing them with the database migration history. Regenerate the envelope
specs against that schema to reconcile the migration-version check, then generate
and apply only this source's coverage mutations. No database reset, seed changes,
new officer records, or downstream contract changes.
