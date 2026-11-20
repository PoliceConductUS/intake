# net/clearinghouse

## Overview

Groups the intake sources whose data comes from `clearinghouse.net`, the Civil
Rights Litigation Clearinghouse. It holds no code of its own; the one source
under it is `net/clearinghouse/api`.

## Subdirectories & Boundaries

- api: [./api/README.md](./api/README.md) - source `net/clearinghouse/api`.
  Its acquire phase searches the Clearinghouse API for policing civil cases
  per agency and writes `.cases.json` files; its transform phase returns
  `CivilCases`, `CivilCasePersonnel` and `CivilCaseLinks` artifacts.
