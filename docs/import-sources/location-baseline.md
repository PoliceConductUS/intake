# Location Baseline Source Notes

The location baseline should use public civic geography sources, not USPS ZIP
delivery data.

Initial source files downloaded to the workspace:

- `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_place_national.zip`
- `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_counties_national.zip`

The Census Gazetteer files provide national 2020 place and county records with
canonical names, GEOIDs, land/water area, and internal point latitude/longitude.
They do not provide a direct place-to-county parent relationship for every place.
A future location source module should resolve place parents from TIGER/Line
geometry or another authoritative relationship source before generating the
baseline `ImportImport`.

USPS ZIP data should not be the primary source for `public.location_path`.
Postal ZIP codes are delivery routes, and the free Census ZCTA files are
approximations of ZIP Code Tabulation Areas, not civic place hierarchy records.
ZCTA/ZIP support should be modeled as a later postal-code lookup import, not as
canonical state/county/place paths.

Once the baseline location import is loaded for an area, later source imports
should not dynamically create places. A source location miss should mean either:

- the baseline location import is missing a canonical location, or
- the source needs a `public.location_path_alias` row.
