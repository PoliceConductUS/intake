# org/policeconduct

## Overview

Intake sources for data that the Institute for Police Conduct holds itself:
records a curator enters by hand, and reports submitted through the website.
Both sources are declared `standalone: true`. There is no code directly in this
folder.

## Subdirectories & Boundaries

- manual: [README](./manual/README.md) - source `org/policeconduct/manual`.
  Acquire takes one record of a handled record kind from the environment or an
  interview on stdin, validates it against the generated spec, and appends it to
  the sha-chained manual output in state; transform returns those entries as
  artifacts grouped by import artifact kind.
- submissions: [README](./submissions/README.md) - source
  `org/policeconduct/submissions`. Acquire syncs the submissions bucket folder
  with S3; transform reads verified `reportNew` submissions, emits `Reviews` and
  `ReviewPersonnel` records for approved submissions whose officers resolve, and
  lists the held ones in `review-report.json`.
