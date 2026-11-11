# Design

Enumerate source acquisition Command envelopes with canonical Command IO, sorted by timestamp-bearing command directory. Include existing output directories up to the source's latest completed acquisition, excluding incomplete resume outputs. Require the latest output and its acquisition descriptor to exist. Do not infer that newer abandoned command output is a completed acquisition. Missing historical output directories represent explicit operator pruning, not a fallback input.

For each retained snapshot, temporarily select it through the existing acquire pointer, run the unchanged transform/generate/up pipeline, and restore the original pointer in finally. Complete each snapshot before advancing. Existing transform digest checks therefore continue to validate the exact selected input. No source-specific replay logic and no changes to slug protection.

Tests cover chronological replay, updates and older-only records, failure stopping subsequent snapshots, pointer restoration, omitted pruned output, and rejection of missing latest input. All changes remain isolated.
