# TCOLE generation corrections — September 22, 2026

User-authorized continuation: run TCOLE generation to completion, investigate
coordinate/place failures, and make explicit corrections through the cache CLI.
The user separately approved excluding administrative placeholders with bogus or
missing office addresses. Work is on `redesign-config-driven-intake`, using the
local development database and the existing acquired TCOLE export.

## Location assignments

[Complete 94-row correction audit](location-assignments.csv) records source IDs,
canonical IDs, points, selected paths, boundary distances, evidence, and CLI
command IDs. Every saved override was read back through canonical cache IO and
compared with the expected location ID. These are explicit manual assignments;
they do not assert that the retained points lie inside the selected city.

- 74 listed-city assignments are within 10 km in the point's county or reference
  existing manual communities without boundaries.
- Grayson College is assigned to Denison, 846.2 metres from its city boundary.
- Lakeport, Talty, and East Mountain police use their named cities rather than
  their different mailing cities. Their points are 15.2, 730.4, and 95.9 metres
  outside the respective boundaries.
- Katy ISD and two Randall County agencies use Katy and Amarillo. PostGIS checks
  confirmed those city geometries intersect Harris and Randall counties,
  respectively, despite a different county being used in their canonical paths.
- Three agencies reference the new manual places below.
- Ten individually reviewed rural postal assignments exceed 10 km. Their exact
  distances and supporting records are recorded in the CSV: Garden City,
  El Paso, Sandia, Bay City, Barry, Graford, Henderson, San Augustine, Cleveland,
  and Hempstead. These are postal assignments, not containment matches.

County differences are explicit: Live Oak Constable 1's point is in Live Oak
County while canonical Sandia is in Jim Wells County; San Jacinto Constable 3's
point is in San Jacinto County while canonical Cleveland is in Liberty County.
Hudspeth Constable 3's source office point and selected El Paso city are in
El Paso County, despite the agency's Hudspeth jurisdiction. The association's
[constable directory](https://www.wtjpca.org/COUNTIES/Hudspeth2.html) lists the
source street number at Highway 62/180 with an El Paso mailing address; the
[county's JP directory](https://www.co.hudspeth.tx.us/page/JP) corroborates the
adjoining 19900 Highway 62/180 office address.

## Corrected office point

Agency `325101`, Medina County Constable Precinct 1, has source address
`2191 CR 467, Hondo`. The
[county's current directory](https://www.medinatx.gov/page/medina.Constable)
explicitly lists this office at `1100 16th Street, Hondo, TX 78861`.
A fresh Census address-geocoder match returned latitude `29.350344844593` and
longitude `-99.140812552488`; PostGIS confirmed containment in Hondo and Medina
County. Saved both through `cache set --force`:

- Latitude command ID: `opw6s88vz3imuar1xdmo3z7r`.
- Longitude command ID: `ibglqf0stupo2y4dmids17sg`.

The imported source address text is unchanged; the coordinate override uses the
verified current office address. The previous coordinates remain in cache history.

## New manual places

| Place                         | Canonical ID               | Path                                             |
| ----------------------------- | -------------------------- | ------------------------------------------------ |
| Miller Grove                  | `hnb9zc6m18zgm5i9mrvsyqhj` | `/tx/hopkins-county/miller-grove/`               |
| Martinsville                  | `poxhi5216594mpxynuz2mqkk` | `/tx/nacogdoches-county/martinsville/`           |
| Alabama-Coushatta Reservation | `g75655m5nepj2u6r591f158a` | `/tx/polk-county/alabama-coushatta-reservation/` |

Recorded through `data acquire org.policeconduct.manual`, then transformed,
generated, and applied as `000004-org.policeconduct.manual.DatabaseMutations.yaml`.
Verified each row's ID, path, county parent, and lack of geometry. The manual
source contains these records durably for future resets. No invented polygons
or centroids were added. The checked-in
[manual location list](../../../openspec/changes/manual-location-cache-corrections/manual-locations.csv)
includes their evidence sources.

## Approved exclusions

Excluded the 49 remaining administrative placeholders in source IDs
`515002`–`515051` (excluding `515014`, which was already excluded). Each had
`NULL` as its office address except Foreign Service, which had `12t`.
Every exclusion was saved through `data exclude` with a reason in
[sources/gov.tx.tcole/excluded.yaml](../../../sources/gov.tx.tcole/excluded.yaml).
No new acquisition was run; TCOLE was transformed from the existing export.

Canonical artifact reads compared the before/after record keys and verified that
only these agencies and their dependent rows were removed:

| Kind               |  Before |   After | Removed |
| ------------------ | ------: | ------: | ------: |
| Agencies           |   2,948 |   2,899 |      49 |
| Personnel          | 129,929 | 129,929 |       0 |
| AgencyPersonnel    | 170,487 | 170,372 |     115 |
| AgencyPhoneNumbers |   5,497 |   5,449 |      48 |

All removed dependent records referenced one of the 49 excluded agency IDs. No
unrelated dependent rows or personnel were removed, and no new records appeared.

## Final generation

`npm run cli -- data generate gov.tx.tcole` completed with exit code 0 and
reported `data: appended 000005 (649675 mutations).`

Canonical IO verified `000005-gov.tx.tcole.DatabaseMutations.yaml` belongs to
`gov.tx.tcole`, follows `000004`, and references 130 mutation chunks. The first
chunk contains all 2,899 generated agency creates. Their contents verify all
94 corrected location assignments, both corrected Medina coordinates with
automatic Hondo resolution, and the absence of all 49 excluded placeholders.

`data status` confirms entries 000001–000004 are applied and TCOLE entry 000005
is pending. The user requested generation; the generated TCOLE mutations have
not been applied. No full reset or source re-download was performed.

Validation: all seven exclusion CLI tests passed, all 18 OpenSpec items passed,
and the modified files pass formatting and whitespace checks.
