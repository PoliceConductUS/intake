## Why

Manual curation already contains coverage links and personnel associations, but
its static output declaration omits their artifact kinds and blocks reset.

## What Changes

Declare CoverageLink and CoverageLinkAgencyPersonnel in the manual source's
handled kinds, using the existing model-driven acquisition and transform.

## Impact

No migration, seed change, generated contract change, or database reset required.
