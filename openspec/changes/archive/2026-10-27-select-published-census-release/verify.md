# Verification

- The acquisition regression reproduced the reported failure at `TIGER2026/STATE/tl_2026_us_state.zip` after downloading three 2026 Gazetteer ZIPs.
- After the fix, the acquisition tests write 114 matching 2025 source files when Gazetteer is ahead, and automatically select 2026 when both releases exist. Unpublished files, no shared release, mismatched year pages, and HTTP errors fail before ZIP downloads.
- Census regression suite: 12 files, 78 tests passed.
- Type checking, build, formatting, and OpenSpec validation passed (14 items).
- Live verification on 2026-09-21 selected the published 2025 Gazetteer year page and verified all 111 required TIGER files across five directory listings, yielding 114 total source files. The live check fetched listings, not the complete ZIP payloads.

No user's database, acquisition history, or identity mappings were changed. Re-run Census acquisition from the redesign branch to save the selected release through the normal workflow.
