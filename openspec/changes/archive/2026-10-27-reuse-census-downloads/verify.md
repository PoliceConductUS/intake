# Verification

- `npx vitest run test/cli/acquire/acquire-command.test.ts test/sources/us-census-gazetteer --maxWorkers=2`: 13 files, 92 tests passed. Covers completed/interrupted acquisition inputs, verified reuse, missing and changed ZIPs, damaged payloads, truncated files, failed replacement, unexpected vintage files, ignored range requests, invalid HTTP range metadata, and incomplete response bodies.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run openspec:validate`: 15 items passed.

## Live reuse check

Ran the downloader against the saved `tl_2025_48_place.zip` from the completed `2026-08-22T07-38-16-990Z-alprnve2ra3xikdv758bkcz3` acquisition in the development workspace, writing only to a temporary output directory.

The Census server returned HTTP 206 with `Content-Range: bytes 9716483-9782039/9782040`. The downloader fetched 65,557 bytes, verified the saved archive's entry checksums, and reused the 9,782,040-byte ZIP without a full download. SHA-256 checks confirmed the original was unchanged and the new copy matched it. Removed the temporary output afterward.

No full acquisition or database rebuild was run. Existing workspace inputs were not modified.
