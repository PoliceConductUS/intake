# Classification of the 57 remaining legacy paths

Reviewed 2026-09-21 on `redesign-config-driven-intake`, after the eight-alias
batch in commit `1a31ed9`. This is the current detailed assessment of the
57 unresolved paths from the [104-row audit](review-104.csv).

**Missing from the imported Census PLACE files does not mean invalid for this
site. Townships and named communities are places for the site.** Thirty rows
identify legitimate locations missing from our tree. Alba Township is a confirmed
Census source-coverage gap: Census has county-subdivision GEOID 2706300604, while
our Census source does not read county-subdivision inputs. See `sources/us-census-gazetteer/lib/roles.ts` (roles at lines 1–17)
and `sources/us-census-gazetteer/transform.ts` (Gazetteer reads at lines 67–72).

The prior reconstruction proved no lost records **within the files we imported**.
It did not prove that those files cover every place the site needs. The earlier
blanket suggestion that the remaining gaps were all outside Census was too broad.

## Township coverage and Census breadcrumbs

No township-exclusion requirement was found in the repository ADRs, accepted
specifications, archived redesign decision documents, or the source reader.
The role-classification history (`ab26748`) retained the existing state/county/
PLACE selection without a township-exclusion rationale. That does not justify
omitting a township from this site's place hierarchy.

The live [Alba Township Census profile](https://data.census.gov/profile/Alba_township%2C_Jackson_County%2C_Minnesota?g=060XX00US2706300604)
uses United States → Minnesota → Jackson County → Alba township. The live
[Bruceville-Eddy city profile](https://data.census.gov/profile/Bruceville-Eddy_city,_Texas?g=160XX00US4810828),
verified in the browser on 2026-09-21, uses United States → Texas → Bruceville-Eddy
city, Texas. Its breadcrumb omits the county; it does not choose McLennan or
Falls County for the whole city. Census profile breadcrumbs therefore do not
establish a universal state → county → place tree.

## Results

| Classification                           |   Rows |
| ---------------------------------------- | -----: |
| Outdated or superseded geography         |      5 |
| Legitimate missing location              |     30 |
| Incorrect hierarchy                      |     13 |
| Mailing city and municipality mixed      |      3 |
| Legitimate location with different scope |      3 |
| Original geographic scope unresolved     |      3 |
| **Total**                                | **57** |

No further same-place alias is confirmed by this review. Little River and Eddy
have identified successor municipalities, but merging a predecessor into a larger
municipality is different from renaming the same place. An alias for those would
be a deliberate successor redirect, not a finding of identical geography.

The three original-scope uncertainties are Brookeland, Indianapolis, and
Nashville. Honolulu has a documented Census split, but the old record's intended
scope is also unconfirmed. The malformed DC/Fairfax/Washington path does not
identify a defensible replacement. These limits are explicit in the row findings.

The thirteen incorrect hierarchies are assessed against the named entity, not
against every use of the same postal city name. Boerne, Kyle, and La Vernia are
listed separately because the linked agency belongs to a different municipality.
Old agency assignments and placeholder addresses are not proof of geography.

Existence and county evidence for a community do not establish its full current
boundary. No community boundary, location, alias, or agency assignment was
created by this classification pass. This report identifies the work needed;
it does not silently substitute a nearby Census city.

## Evidence and individual decisions

[Download all 57 decisions](remaining-57-classification.csv). Each row preserves
the original ID/path, classification, evidence scope, source, existing candidate,
and next action. Existing Census comparisons come from the saved 2025 files in
[census-check-104.json](census-check-104.json). External references establish
community identity or historical changes; they were not acquired into intake.
Historical-reference dates limit claims about present-day boundaries.

### Outdated or superseded geography

| Audit row | Old path                        | Finding                                                                                                                                                                                                                               | Source                                                                                                   |
| --------: | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
|         1 | `/ct/new-haven-county/`         | New Haven County is a legitimate historical geography, superseded as a Census county equivalent by the planning-region system. Eight counties became nine regions; no one-to-one successor is established.                            | [Reference](https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes/2023-01.html) |
|        15 | `/tx/bell-county/little-river/` | Little River and Academy merged around 1980. Little River is a predecessor/community name, while Little River-Academy is the combined municipality. A successor relationship is established; identical geographic scope is not.       | [Reference](https://www.tshaonline.org/handbook/entries/little-river-academy-tx)                         |
|        68 | `/tx/mclennan-county/eddy/`     | Bruceville and Eddy incorporated together in 1974. Eddy names one predecessor community and remains in mailing addresses; Bruceville-Eddy is the combined city. A successor relationship is established, not whole-place equivalence. | [Reference](https://www.bruceville-eddy.us/wp-content/uploads/2024/06/20240613-BEEDC-Agenda-Packet.pdf)  |
|        92 | `/ct/hartford-county/`          | Hartford County is a legitimate historical geography, superseded as a Census county equivalent by the planning-region system. It must not be aliased wholesale to Capitol Planning Region.                                            | [Reference](https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes/2023-01.html) |
|        96 | `/hi/honolulu-county/honolulu/` | Honolulu CDP was split for the 2010 Census into Urban Honolulu, East Honolulu and a portion of Hickam. Honolulu can also mean the city/county. The bare legacy name does not identify one equivalent successor.                       | [Reference](https://files.hawaii.gov/dbedt/economic/databook/db2012/db2012.pdf)                          |

### Legitimate missing location

| Audit row | Old path                                | Finding                                                                                                                                                                                                                                           | Source                                                                                                                             |
| --------: | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
|         3 | `/mn/jackson-county/alba-township/`     | Alba Township is a legitimate township in Jackson County. Census identifies it as county subdivision GEOID 2706300604. Our source reader handles states, counties and PLACE files, not COUSUB files. This is an import coverage gap for the site. | [Reference](https://data.census.gov/profile/Alba_township%2C_Jackson_County%2C_Minnesota?g=060XX00US2706300604)                    |
|         6 | `/tx/anderson-county/tennessee-colony/` | Tennessee Colony is a separate Anderson County community; Trinidad is not its replacement.                                                                                                                                                        | [Reference](https://www.tshaonline.org/handbook/entries/tennessee-colony-tx)                                                       |
|         7 | `/tx/angelina-county/pollok/`           | Pollok is a separate Angelina County community; Hudson is not an equivalent.                                                                                                                                                                      | [Reference](https://www.tshaonline.org/handbook/entries/pollok-tx)                                                                 |
|        10 | `/tx/austin-county/bleiblerville/`      | Bleiblerville is a separate Austin County community, not Bellville or Industry.                                                                                                                                                                   | [Reference](https://www.tshaonline.org/handbook/entries/bleiblerville-tx)                                                          |
|        11 | `/tx/bandera-county/medina/`            | Medina in Bandera County is a separate community from the Census Medina CDP in Zapata County.                                                                                                                                                     | [Reference](https://www.tshaonline.org/handbook/entries/medina-tx)                                                                 |
|        17 | `/tx/bexar-county/atascosa/`            | Atascosa is a Bexar County community, distinct from Macdona and from Atascosa County.                                                                                                                                                             | [Reference](https://www.tshaonline.org/handbook/entries/atascosa-tx)                                                               |
|        23 | `/tx/bowie-county/simms/`               | Texas A&M AgriLife lists Simms as a Bowie County community; New Boston is a different place.                                                                                                                                                      | [Reference](https://agrilifeextension.tamu.edu/counties/bowie-county/)                                                             |
|        25 | `/tx/caldwell-county/maxwell/`          | Maxwell is a Caldwell County community. Its absence does not justify assigning its identity to Kyle.                                                                                                                                              | [Reference](https://www.tshaonline.org/handbook/entries/maxwell-tx)                                                                |
|        31 | `/tx/coryell-county/jonesboro/`         | Jonesboro lies on the Coryell-Hamilton county line. The Coryell path is geographically legitimate; Cranfills Gap is not a replacement.                                                                                                            | [Reference](https://www.tshaonline.org/handbook/entries/jonesboro-tx)                                                              |
|        36 | `/tx/fannin-county/ivanhoe/`            | Ivanhoe in Fannin County is a distinct community, absent from the saved PLACE inputs; Census Ivanhoe city in Tyler County is not equivalent.                                                                                                      | [Reference](https://www.tshaonline.org/handbook/entries/ivanhoe-tx)                                                                |
|        44 | `/tx/hardin-county/batson/`             | Batson is a separate Hardin County community; Hull in Liberty County is not equivalent.                                                                                                                                                           | [Reference](https://www.tshaonline.org/handbook/entries/batson-tx)                                                                 |
|        45 | `/tx/hardin-county/saratoga/`           | Saratoga is a separate Hardin County community; Hull in Liberty County is not equivalent.                                                                                                                                                         | [Reference](https://www.tshaonline.org/handbook/entries/saratoga-tx)                                                               |
|        47 | `/tx/harris-county/cypress/`            | Harris County documents Cypress as a named community. It is not a synonym for the whole city of Houston.                                                                                                                                          | [Reference](https://historicalcommission.harriscountytx.gov/portals/historicalcommission/documents/Communities%20in%20Markers.pdf) |
|        48 | `/tx/harris-county/huffman/`            | Huffman is a separate eastern Harris County community; the whole city of Houston is not equivalent.                                                                                                                                               | [Reference](https://www.tshaonline.org/handbook/entries/huffman-tx)                                                                |
|        51 | `/tx/harrison-county/elysian-fields/`   | Elysian Fields is a Harrison County community, not an alternate name for Waskom.                                                                                                                                                                  | [Reference](https://www.tshaonline.org/handbook/entries/elysian-fields-tx)                                                         |
|        52 | `/tx/henderson-county/larue/`           | Larue is a Henderson County community with its own history; it is not Poynor.                                                                                                                                                                     | [Reference](https://www.tshaonline.org/handbook/entries/larue-tx)                                                                  |
|        55 | `/tx/hopkins-county/saltillo/`          | Saltillo is in Hopkins County; Mount Vernon in Franklin County is a different community.                                                                                                                                                          | [Reference](https://www.tshaonline.org/handbook/entries/saltillo-tx)                                                               |
|        56 | `/tx/hopkins-county/sulphur-bluff/`     | Sulphur Bluff is a Hopkins County community; Tira is not its replacement.                                                                                                                                                                         | [Reference](https://www.tshaonline.org/handbook/entries/sulphur-bluff-tx)                                                          |
|        57 | `/tx/hunt-county/merit/`                | Merit is in Hunt County. The Bland school consolidation does not make Merit equivalent to Farmersville in Collin County.                                                                                                                          | [Reference](https://www.tshaonline.org/handbook/entries/merit-tx)                                                                  |
|        61 | `/tx/lamar-county/pattonville/`         | Pattonville is in southeastern Lamar County and is distinct from Deport.                                                                                                                                                                          | [Reference](https://www.tshaonline.org/handbook/entries/pattonville-tx)                                                            |
|        67 | `/tx/matagorda-county/el-maton/`        | El Maton, also written Elmaton, is in Matagorda County. This spelling variant has no existing canonical Elmaton target; Blessing is different.                                                                                                    | [Reference](https://www.tshaonline.org/handbook/entries/elmaton-tx)                                                                |
|        70 | `/tx/montgomery-county/new-caney/`      | New Caney is a Montgomery County community with its own identity; Woodbranch is not equivalent.                                                                                                                                                   | [Reference](https://www.tshaonline.org/handbook/entries/new-caney-tx)                                                              |
|        72 | `/tx/nacogdoches-county/douglass/`      | Douglass is a Nacogdoches County community, distinct from Cushing.                                                                                                                                                                                | [Reference](https://www.tshaonline.org/handbook/entries/douglass-tx)                                                               |
|        73 | `/tx/nacogdoches-county/woden/`         | Woden is a Nacogdoches County community; the city of Nacogdoches is not an equivalent.                                                                                                                                                            | [Reference](https://www.tshaonline.org/handbook/entries/woden-tx)                                                                  |
|        76 | `/tx/polk-county/moscow/`               | Moscow is a Polk County community, distinct from Seven Oaks.                                                                                                                                                                                      | [Reference](https://www.tshaonline.org/handbook/entries/moscow-tx)                                                                 |
|        86 | `/tx/travis-county/del-valle/`          | Del Valle is a Travis County community. Its historic and mailing identity is not equivalent to the whole city of Austin.                                                                                                                          | [Reference](https://www.tshaonline.org/handbook/entries/del-valle-tx)                                                              |
|        87 | `/tx/trinity-county/apple-springs/`     | Apple Springs is a Trinity County community, not Hudson in Angelina County.                                                                                                                                                                       | [Reference](https://www.tshaonline.org/handbook/entries/apple-springs-tx)                                                          |
|        89 | `/tx/uvalde-county/concan/`             | Concan is a Uvalde County community, not Leakey in Real County.                                                                                                                                                                                   | [Reference](https://www.tshaonline.org/handbook/entries/concan-tx)                                                                 |
|       100 | `/tx/mclennan-county/axtell/`           | Axtell is a McLennan County community, distinct from Hallsburg.                                                                                                                                                                                   | [Reference](https://www.tshaonline.org/handbook/entries/axtell-tx)                                                                 |
|       102 | `/tx/upton-county/midkiff/`             | The Texas Historical Commission identifies Midkiff in Upton County, including its post-office marker. It is distinct from Rankin.                                                                                                                 | [Reference](https://atlas.thc.texas.gov/Details/5507013883)                                                                        |

### Incorrect hierarchy

| Audit row | Old path                           | Finding                                                                                                                                                         | Source                                                                 |
| --------: | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
|        12 | `/tx/bandera-county/utopia/`       | Utopia is in Uvalde County, not Bandera.                                                                                                                        | [Saved Census check](census-check-104.json)                            |
|        16 | `/tx/bell-county/moody/`           | Moody is in McLennan County, not Bell.                                                                                                                          | [Saved Census check](census-check-104.json)                            |
|        21 | `/tx/bowie-county/avery/`          | Avery is in Red River County, not Bowie.                                                                                                                        | [Saved Census check](census-check-104.json)                            |
|        29 | `/tx/colorado-county/cat-spring/`  | Cat Spring is in Austin County, not Colorado; it is also missing from the current canonical tree.                                                               | [Reference](https://www.tshaonline.org/handbook/entries/cat-spring-tx) |
|        43 | `/tx/hamilton-county/archer-city/` | Archer City is in Archer County, not Hamilton.                                                                                                                  | [Saved Census check](census-check-104.json)                            |
|        63 | `/tx/liberty-county/liberty-hill/` | The relevant Liberty Hill city is in Williamson County, not Liberty County. Liberty is a different city.                                                        | [Saved Census check](census-check-104.json)                            |
|        64 | `/tx/live-oak-county/sandia/`      | The Census Sandia CDP is in Jim Wells County, not Live Oak. A Sandia mailing address can cover a broader area; that does not establish a CDP alias in Live Oak. | [Saved Census check](census-check-104.json)                            |
|        78 | `/tx/red-river-county/kaufman/`    | Kaufman is in Kaufman County, not Red River.                                                                                                                    | [Saved Census check](census-check-104.json)                            |
|        80 | `/tx/runnels-county/mason/`        | Mason is in Mason County, not Runnels.                                                                                                                          | [Saved Census check](census-check-104.json)                            |
|        85 | `/tx/travis-county/buda/`          | The saved Census Buda city polygon is in Hays County, not Travis. A broader Buda mailing area is not the same city geometry.                                    | [Saved Census check](census-check-104.json)                            |
|       101 | `/tx/travis-county/abbott/`        | Abbott city is in Hill County, not Travis. The generic Foreign Service record has a placeholder address and cannot establish an alternative geography.          | [Saved Census check](census-check-104.json)                            |
|       103 | `/dc/fairfax-county/`              | Fairfax County is in Virginia, not the District of Columbia.                                                                                                    | [Saved Census check](census-check-104.json)                            |
|       104 | `/dc/fairfax-county/washington/`   | Washington city is in the District of Columbia and is not a child of Fairfax County. The intended target of this malformed path is not established.             | [Saved Census check](census-check-104.json)                            |

### Mailing city and municipality mixed

| Audit row | Old path                          | Finding                                                                                                                                                                                                        | Source                                      |
| --------: | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
|        18 | `/tx/bexar-county/boerne/`        | The old Boerne/Bexar path mixes the Fair Oaks Ranch agency municipality with a Boerne mailing label. Census Boerne is in Kendall County; Fair Oaks Ranch is a separate city spanning Bexar, Kendall and Comal. | [Saved Census check](census-check-104.json) |
|        24 | `/tx/caldwell-county/kyle/`       | The old Kyle/Caldwell path comes from Uhland Police. Census Kyle is in Hays County; Uhland is a different city spanning Hays and Caldwell. A mailing city is not a municipality boundary.                      | [Saved Census check](census-check-104.json) |
|        40 | `/tx/guadalupe-county/la-vernia/` | The old La Vernia/Guadalupe path comes from New Berlin Marshal. Census La Vernia is in Wilson County; New Berlin is a distinct Guadalupe County municipality.                                                  | [Saved Census check](census-check-104.json) |

### Legitimate location with different scope

| Audit row | Old path                                          | Finding                                                                                                                                                                                                  | Source                                                                                            |
| --------: | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
|        32 | `/tx/dallas-county/dfw-airport/`                  | DFW Airport is a real airport spanning municipal and county boundaries. It is not equivalent to all of Grapevine.                                                                                        | [Reference](https://apps.dfwairport.com/board/doc.php?date=Aug+1%2C+2024&docid=147077)            |
|        46 | `/tx/harris-county/alief/`                        | Alief remains a named community; portions were annexed by Houston. An annexed community is not an alternate name for the whole annexing city.                                                            | [Reference](https://311.houstontx.gov/planning/Annexation/docs_pdfs/HoustonAnnexationHistory.pdf) |
|        95 | `/dc/district-of-columbia-county/n-w-washington/` | Northwest Washington is one of four DC quadrants, a subset of Washington rather than the whole city. The old parent county-suffix variant is already aliased; the remaining child identity is the issue. | [Reference](https://octo.dc.gov/page/dc-gis-glossary)                                             |

### Original geographic scope unresolved

| Audit row | Old path                          | Finding                                                                                                                                                                                                                                                                                                          | Source                                                                                                   |
| --------: | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
|        58 | `/tx/jasper-county/brookeland/`   | Brookeland is a legitimate community but TSHA places the historical town in Sabine County, while this path and constable use Jasper County. The source includes a historical relocation; the modern community versus broader Brookeland postal area needs boundary evidence. No Census Brookeland target exists. | [Reference](https://www.tshaonline.org/handbook/entries/brookeland-tx)                                   |
|        98 | `/in/marion-county/indianapolis/` | Census distinguishes consolidated Indianapolis from Indianapolis city (balance), excluding other incorporated places from the balance. The old bare name and absent linked agency do not establish which extent the record meant.                                                                                | [Reference](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2023/TGRSHP2023_TechDoc_Ch4.pdf) |
|        99 | `/tn/davidson-county/nashville/`  | Census distinguishes consolidated Nashville-Davidson from its balance, excluding separately incorporated places. The old bare Nashville name and placeholder state-agency address do not establish the intended extent.                                                                                          | [Reference](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2023/TGRSHP2023_TechDoc_Ch4.pdf) |
