# gov

## Overview

Groups the intake sources whose reversed domain starts with `gov`: one US Census source, one city source, and state licensing-authority sources. Each source is a folder with an `intake.source.ts` that exports `source`. Two sources acquire and transform data, one transforms only, one is disabled, and six hold only a public-records request definition. This folder holds no code of its own.

## Subdirectories & Boundaries

- [arkansas](./arkansas/README.md) - `gov/arkansas/dps/clest`: the public-records request definition for the Arkansas Commission on Law Enforcement Standards and Training; no acquire, no transform, no artifacts.
- [az](./az/README.md) - `gov/az/post/roster`: the Arizona POST roster source, disabled: `produces` is empty and the transform returns no artifacts.
- [census](./census/README.md) - `gov/census/www2/gazetteer`: the US Census Gazetteer and TIGER source; acquires the newest shared Gazetteer and TIGER year and produces `LocationPaths`, `LocationPathAliases`, and `LocationPathGeometries`.
- [delaware](./delaware/README.md) - `gov/delaware/post`: the public-records request definition for the Delaware Police Officer Standards and Training Commission; no acquire, no transform, no artifacts.
- [irvingtx](./irvingtx/README.md) - `gov/irvingtx/arrests`: Irving arrest analytics; verifies the private workbook and geographic evidence on acquire and produces `ArrestProfiles` and `AgencyArrestProfiles`.
- [ms](./ms/README.md) - `gov/ms/dps/bleost`: the public-records request definition for the Mississippi Board on Law Enforcement Officer Standards and Training; no acquire, no transform, no artifacts.
- [sc](./sc/README.md) - `gov/sc/sccja`: the public-records request definition and portal form for the South Carolina Law Enforcement Training Council; no acquire, no transform, no artifacts.
- [texas](./texas/README.md) - `gov/texas/tcole`: the Texas TCOLE source; transforms the TCOLE public-information workbook into `LicensingAuthorities`, `AuthorityLicenses`, `Agencies`, `Personnel`, `Licenses`, `LicenseActions`, `AgencyPersonnel`, and `AgencyPhoneNumbers`.
- [wisdoj](./wisdoj/README.md) - `gov/wisdoj/lesb`: the public-records request definition for the Wisconsin Law Enforcement Standards Board; no acquire, no transform, no artifacts.
- [wv](./wv/README.md) - `gov/wv/das/leps`: the public-records request definition for the West Virginia Law Enforcement Professional Standards Subcommittee; no acquire, no transform, no artifacts.
