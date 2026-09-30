## Why

Federal office relationships were present in source data but the importer filtered
them out. The empty join table was mistakenly treated as unused. The user chose a
simpler direct parent foreign key and authorized importing all 11 source offices.

## What Changes

- Add nullable `agency.parent_federal_agency_id` referencing `federal_agency.id`.
- Emit parent references on federal office Agency records and resolve them through
  existing canonical source-name mappings.
- Admit federal organizations and their offices independently of personnel/cases.
- Regenerate contracts and request documentation; populate the local database.
- Keep the retired join table absent and leave other table removals in place.

## Capabilities

### New Capabilities

- `federal-office-parent`: Offices are ordinary agencies with a federal parent.
- `resolver-field-omission`: Preserve the existing omitted-versus-null contract across every resolver, with exhaustive regression coverage.

### Modified Capabilities

- `agency-record-selection`: Federal organizations are independent roots whose
  office agencies and directed descendants are included.

## Impact

One additive Supabase migration, generated Agency contracts, the federal source,
and shared graph metadata change. No new dependencies, seed rows, or database reset.
The local data mutation chain records the import. The website agent can query
`agency.parent_federal_agency_id` for branches while retaining normal place URLs.
Production application and website changes remain outside this intake task.
