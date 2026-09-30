## ADDED Requirements

### Requirement: Shared published Census vintage

Census acquisition SHALL select the newest Gazetteer vintage supported by the published TIGER shapefile release index. It SHALL follow the Gazetteer page's year links to obtain matching files and SHALL verify the selected year's required TIGER files against their directory listings before downloading ZIPs. It SHALL log the selected vintage and SHALL NOT mix years. Network failures and incomplete selected releases SHALL fail visibly rather than trigger an implicit retry with older data.

#### Scenario: Gazetteer is newer than TIGER shapefiles

- **WHEN** the Gazetteer page lists 2026 files and a 2025 page, while the TIGER index lists TIGER2025 but not TIGER2026
- **THEN** acquisition selects the linked 2025 Gazetteer page and matching 2025 TIGER files
- **AND** never requests a 2026 TIGER ZIP

#### Scenario: New shared release

- **WHEN** both publications list 2026
- **THEN** acquisition selects 2026 without a code change

#### Scenario: Missing publication or required files

- **WHEN** there is no shared published vintage, the year page returns another vintage, or a required TIGER file is absent
- **THEN** acquisition fails before downloading source ZIPs

#### Scenario: Fetch failure

- **WHEN** fetching a release page or listing fails
- **THEN** acquisition reports the failing URL and status without changing vintage
