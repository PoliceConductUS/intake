# net/bpl-orsnapshot/www

## Overview

Groups the intake sources served from `www.bpl-orsnapshot.net`. It holds no
code of its own; the one source under it is
`net/bpl-orsnapshot/www/public-inquiry-cj`.

## Subdirectories & Boundaries

- public-inquiry-cj: [./public-inquiry-cj/README.md](./public-inquiry-cj/README.md) -
  source `net/bpl-orsnapshot/www/public-inquiry-cj`, the Oregon DPSST public
  CJ IRIS roster. Its acquire phase saves the raw search, officer and agency
  HTML pages with a resumable `manifest.json`; its transform phase returns
  `LicensingAuthorities`, `AuthorityLicenses`, `Agencies`, `Personnel`,
  `AgencyPersonnel`, `Licenses`, `LicenseActions` and `AgencyPhoneNumbers`
  artifacts.
