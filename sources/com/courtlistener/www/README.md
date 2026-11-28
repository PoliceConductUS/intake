# www

## Overview

Groups the intake sources whose namespace starts with `com/courtlistener/www`. It holds one source, `com/courtlistener/www/api`.

## Subdirectories & Boundaries

- api: [./api/README.md](./api/README.md) - The CourtListener source. `acquire` searches dockets by agency; `transform` emits `CivilCases`, `CivilCasePersonnel` and `CivilCaseLinks` artifacts for dockets that name a resolved officer, and `LicensingAuthorities` records that carry the dockets it could not build a case from.
