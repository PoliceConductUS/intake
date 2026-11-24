# youtube

## Overview

Groups the intake sources under the reversed domain `com/youtube`. It holds one source, `com/youtube/policeactivity`.

## Subdirectories & Boundaries

- policeactivity: [./policeactivity/README.md](./policeactivity/README.md) - The PoliceActivity source. `acquire` searches the YouTube channel per agency and year; `transform` emits `CoverageLinks` and `CoverageLinkAgencyPersonnel` artifacts for videos that name a resolved officer.
