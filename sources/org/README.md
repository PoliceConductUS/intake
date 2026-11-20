# org

## Overview

Intake sources whose namespace begins with `org`. Each folder below is the next
part of the reversed domain, and each source folder at the end of a path holds
an `intake.source.ts` that declares the source. There is no code directly in
this folder.

## Subdirectories & Boundaries

- policeconduct: [README](./policeconduct/README.md) - the
  `org/policeconduct/manual` source (records a curator enters by hand) and the
  `org/policeconduct/submissions` source (reports submitted through the
  website, producing `Reviews` and `ReviewPersonnel`).
- psvproject: [README](./psvproject/README.md) - the
  `org/psvproject/arrest-tracker` source, producing `CoverageLinks` and
  `CoverageLinkAgencyPersonnel` from the arrest tracker workbooks and their
  linked articles.
- wikipedia: [README](./wikipedia/README.md) - the
  `org/wikipedia/en/us-federal-law-enforcement-agencies` source, producing
  `FederalAgencies` and `Agencies`.
