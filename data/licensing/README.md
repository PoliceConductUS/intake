# State officer-licensing raw data

One folder per state or territory, named by `location_path`
`state_or_territory_slug`. Each folder holds `licensing.json`, the committed
raw input for that state's officer-licensing summary: the licensing
organization, the facts shown on the state civic index page, and the source
links every fact is backed by.

`status: "pending"` means the state has not been researched yet — the file
is a stub and the importer skips it (visibly). To publish a state:

1. Research the facts on the licensing organization's official site.
2. Fill in `organization`, `facts`, and `sources`; every fact's `sourceKeys`
   must reference `sources[].key` entries in the same file.
3. Set `status: "verified"` and update `asOf`.
4. Import: `npm run cli -- import licensing <state-slug>`

Re-running the import replaces that state's licensing summary and sources
deterministically, so edits can be re-imported at any time. All IDs are
explicit and checked in; never let the database generate them.
