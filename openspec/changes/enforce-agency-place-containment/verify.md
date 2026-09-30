> Current correction: coordinate and location caches use data inputs only.
> Both policy invalidation markers described in historical sections below have
> been removed at the user's direction. See the cache invalidation audit below.

# Place-containment fix and remaining data corrections

Implemented on `redesign-config-driven-intake` under accepted ADR 0024 and the
accepted `artifacts-database-import` specification.

## Removal of hard-coded data rules — September 21, 2026

At the user's direction, all three city-name rewrites and all five ZIP-to-place
exceptions have been removed from executable code. The import reader now applies
only explicit operator artifact mutations. Automatic address resolution requires
place containment; manual cache overrides and exclusion data are unchanged.
The location cache uses policy `place-containment-v3-no-postal-exceptions`, so
old automatically derived assignments are rechecked without invalidating address
coordinates. The ADR and current OpenSpec requirements no longer permit those
postal exceptions.

Validation: 78 tests passed across artifact reading, place containment, geocode
resolvers, DataContext, and cache CLI. Regression cases cover all three city
spellings, all five formerly excepted ZIPs, and reuse of an old-policy location
cache. No workspace records were changed and no rebuild ran.

## Earlier verification (postal exceptions subsequently removed)

- Removed county-local city/alias matching, statewide name matching, and nearest
  place selection from address-derived location resolution.
- Restored the existing, explicitly specified postal-area exceptions after a
  containing-place miss. Their targets must be place rows. Multiple containing
  places still fail without an exception.
- Removed the geocoder's city/place and ZIP-area centroid substitutions. A batch
  miss may retry the actual street address; unresolved addresses stay unresolved.
- Failure diagnostics for a missing containing place identify the source record,
  canonical identity, agency name, address, city, state, ZIP, and coordinates.
- Versioned coordinate and location cache inputs by the corrected policies.
  Removed reuse of inferred values from existing database rows on cache misses.
  Derived coordinates and locations from the old policies must resolve again;
  current-policy caches, explicit source values, and manual cache corrections retain their
  existing precedence. ZIP is included in the location cache input because the
  permitted postal rules depend on it.

This means the next preparation of an agency with old derived coordinate caches
may geocode its address again. The change does not reacquire source data, clear
the whole workspace, alter identities or slugs, or rewrite immutable data-chain
entries.

## Sam Rayburn ISD

Its stored address is `9363 E. FM 273, Ivanhoe, TX 75447`, consistent with the
[district's address](https://srisd.org/52460_3). The
[NCES district record](https://nces.ed.gov/ccd/districtsearch/district_detail.asp?DistrictID=4838640&ID2=4838640&Search=2&details=1)
identifies Fannin County.

The stored point, `33.76749429006, -96.10511487177`, is inside the imported Fannin
County polygon and outside all imported Census place polygons. The corrected
resolver rejects that point instead of assigning Ivanhoe in Tyler County. The
existing contract requires a place; it does not authorize returning only the
county or fabricating a place boundary.

## Earlier local data findings

A read-only transaction ran the corrected place resolver over all **3,352**
local agency records using their stored points. **3,135** resolved to their
existing location and **217** failed because no place contains the point and no
explicit postal rule supplies a place. Sam Rayburn ISD is among those failures.

[Complete results, including every unresolved agency and address](local-validation.json)
are checked in with this fix. This is a spatial audit of stored coordinates,
not verification that every stored coordinate came from a physical address.
The former centroid fallback makes that distinction material, especially for
the two Medina agencies identified in the earlier audit.

**Existing local database rows have not been repaired or deleted.** Replaying
historical mutations reproduces their stored values; replay does not run the
resolver. New preparation uses the corrected policy and fails for unresolved
records. Fixing those records requires verified address points or appropriate
baseline place geometry, not another automatic fallback. No production data
was changed and no new live geocoding was performed during this verification.

## Tests and checks

- Observed nine failing regression tests before the location/cache fixes.
- Observed three additional failing tests before removing centroid substitution
  and old-coordinate reuse.
- Final full suite: **96 test files, 621 tests passed**.
- Typecheck and TypeScript build passed.
- OpenSpec validation: **11 items passed**.
- Scoped formatting, links, and whitespace checked before commit.

The first full run hit one database-container startup timeout in an unrelated
float-precision test. It passed alone; the final full run passed with a
120-second hook allowance. No test assertion was weakened and no timeout change
was committed.

## Census request coalescing

The failed TCOLE generation started 2,949 single-address batch requests between
22:33:44.856Z and 22:33:47.728Z on September 21, 2026. Concurrent facade resolution
called the geocoder separately; its existing batch splitting applied only inside
each call.

CurrentRowReader's memoized macrotask coalescing now lives in a shared BatchLoader
used by both database reads and Census coordinates (ADR 0016 decision 10). The
loader serializes gateway calls, including work arriving during an active batch.
Census retains its existing 1,000-address limit and same-address retry behavior.
Geocoding loads use the normalized request address as their key and map the
returned coordinates back to each caller's canonical identity. A request failure
rejects pending work and stops additional requests through that loader.

Validation: 73 tests passed across agency-coordinate-resolver, current-row-reader,
data-context, geocode-resolvers, and cache CLI suites. The 2,949-caller regression
produces batches of 1,000, 1,000, and 949 with a maximum of one active request.
Additional checks cover late arrivals during single-address attempts, shared
normalized addresses, failure propagation, and multi-table database coalescing.
Type checking, build, and all 17 OpenSpec items passed. No development database
reset or live Census load test was run.

## Cache correction diagnostics

The failed agency is TCOLE source `1101`, canonical Agency
`cm76wpxay0008vrvgb79ptov8`, ANDERSON CO. CONST. PCT. 1, with address
P.O. Box 952, Elkhart, TX 75839. Read-only cache inspection found coordinates
31.6279683, -95.5789576 under fingerprint
`5bfb42835a77133d31b89e72a486fbeef9f4809c1985392c3799296ddf50016e`. This exactly
matches the address input without the address-point policy. Adding the current
policy gives `75c101227ca6d388bae58eace303465946064e0fd3eaa7d248a3b52fedb18363`,
so those legacy coordinates are not a reusable hit. Their physical-location
accuracy has not been established, and no manual acceptance was written.

Shared EntityFacade error handling now supplies shell-quoted cache get/set
command templates for failed live resolution of cache-backed properties. It
retains the original cause and canonical identity, explains existing-value
overrides, and preserves attribution when a dependency fails. Source-supplied
values and cache storage errors do not receive misleading override guidance.
Unmatched-coordinate errors identify both latitude and longitude, the source
record and agency address, and the need for verified physical coordinates.

Validation: 74 tests passed across cache-correction-errors, geocode-resolvers,
data-context, cache CLI, and reset suites. Tests cover the old-fingerprint PO-box
case, multiple entity kinds and properties, dependency attribution, source
precedence, and shell metacharacters in source IDs. Type checking, build, and
all 17 OpenSpec items passed. No cache values were changed and no rebuild ran.

## Address-only coordinate reuse

Removed `address-point-v1` from latitude/longitude cache inputs. Normalized
address inputs alone determine automatic coordinate reuse: unchanged addresses,
including case/spacing changes, use existing values; changed addresses resolve
again on a cache miss and preserve the prior address entries. Explicit manual
overrides retain their existing behavior. Location-path containment matching is
separate and this correction does not change it.

The unchanged-address and formatting-only regressions both failed before the
fix by calling live resolution and returning new coordinates. After the fix,
73 focused tests passed (geocode-resolvers, cache-correction-errors, data-context,
CLI cache), plus type checking, build, and all 17 OpenSpec items.

A read-only audit used canonical Artifacts and ResolvedProperty IO and the latest
TCOLE source addresses. Across 8,534 coordinate cache files, two entries matched
the removed marker for those addresses. Both had identical address-only entries;
none required a cache rewrite. No cache or database values were changed.

## Diagnostic rollback

Reverted the extra cache-state reads and rejected-value diagnostic output from 4906018. Retained address-only coordinate reuse and its regression tests, the
plain geocoding failure sentence, and the pre-existing cache get/set command
guidance. Agency 1202 retains the Google-coordinate manual overrides at the
user's direction.

Rollback validation: 71 focused tests passed, along with type checking, build,
all 17 OpenSpec items, formatting of changed TypeScript files, and diff checks.
Read-only CLI inspection confirmed both Google-coordinate overrides remain.

## Cache invalidation audit and location-marker removal

Audited cache input declarations, fingerprint construction, reads/writes, and
version/policy/salt references in `src`, `sources`, and `scripts`.

- Coordinate keys previously included `address-point-v1`; removed in 70b7430.
- Location assignment keys included `place-containment-v3-no-postal-exceptions`
  (previously earlier containment versions); removed in this change.
- Removed the separate location ZIP input introduced for the now-removed postal
  rules. The restored location key contains latitude, longitude, normalized city,
  and normalized state, matching established automatic cache entries.
- No other policy/version markers were found in resolved-property cache keys.
  `ResolverPolicy` controls defaults/errors, not cache identity. The migration
  fingerprint checks generated schema freshness, not cached data reuse.

The unchanged-location and ZIP-only regressions failed before implementation.
After removal, unchanged inputs reuse the cached assignment; changed point/city
inputs resolve again, and missing containment still fails on a cache miss.
All 76 focused tests passed, plus type checking, build, and 17 OpenSpec items.

The agency 1903 location correction was applied through the cache CLI and read
back: `cebydviefa4lpellq0sns63h`, `/tx/anderson-county/tennessee-colony/`.
Its original Trinidad entry remains as historical automatic data; the explicit
manual override takes precedence. No database reset or full generation was run.
