# Current prompts and reset preparation

## Outcome

Only summaries produced for the current prompt may enter the database. A stale retained input must be found before reset clears the configured database.

## Implementation

The Minnesota prompt is a UTF-8 text file adjacent to its analyzer. A small loader reads its exact bytes and computes SHA-256. Analyzer, cache, acquired results, and evidence validation share that fingerprint. There is no numeric-version fallback. Acquisition may reuse the unchanged PDF and extracted text while regenerating obsolete analysis.

Reset prepares existing retained automatic inputs through the existing transform path before the schema reset. A fresh source with no completed acquisition can still acquire during default reset; malformed existing pointers and inputs fail. Standalone manual sources have no retained acquisition to prepare. Acquisition keeps its existing post-upstream-apply timing because consumer sources query the rebuilt agency roster. Newly acquired inputs follow the current acquisition validation path. It restores each original acquisition pointer even on failure. Only successful preparation permits schema reset and mutation retirement. Rebuild then follows the existing source dependency and chronological order. Preparation writes command artifacts but does not generate or apply database mutations.

## Decisions

The user requires current prompts only and asked to separate prompt text from code. The fingerprint and reset preparation are implementation choices stated in chat. The user chose to verify the exact unchanged version-2 prompt and convert its metadata rather than regenerate all 531 current summaries. All 70 obsolete retained summaries have current results for identical PDF hashes; use those current results instead of the obsolete analyses. Preserve original acquisition files privately and do not edit analysis caches directly. No conversion may imply that a version-1 result used the current prompt.
