# org/psvproject

## Overview

Intake sources whose data is acquired from the Police Sexual Violence Project.
There is one source in this folder and no code directly in it.

## Subdirectories & Boundaries

- arrest-tracker: [README](./arrest-tracker/README.md) - source
  `org/psvproject/arrest-tracker`. Acquire downloads the 2025 and 2026 arrest
  tracker workbooks and the articles they link; transform checks each reviewed
  article against its digest and passages, resolves the reviewed officers, and
  produces the `CoverageLinks` and `CoverageLinkAgencyPersonnel` artifacts plus
  a `mapping-report.json` in state.
