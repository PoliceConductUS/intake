# parse

## Overview

Readers for the file formats a source's transform may need: ESRI shapefiles
and GeoJSON (`geo.ts`) and ZIP archives (`zip.ts`). `geo.ts` is the only file
that imports the `shapefile` library.

## Interface

- `geo.ts:readShapefile` - `(shpPath, dbfPath?)` yields one `GeoFeature` at a
  time.
- `geo.ts:readGeoJson` - `(path)` returns `GeoFeature[]`; a bare `Feature` or
  geometry is wrapped as one feature.
- `geo.ts:GeoFeature` - `{ properties, geometry }`.
- `zip.ts:verifyZipContentsFromFd` - `(fd)`.
- `zip.ts:listZipEntries` - `(zipPath)` returns the entry names.
- `zip.ts:readZipEntryBuffer` - `(zipPath, entryName)` returns a `Buffer`.
- `zip.ts:readZipEntryText` - `(zipPath, entryName)` returns a string.

## Invariants

- `zip.ts:verifyOpenedZipContents` - rejects with
  `ZIP integrity mismatch: <entry>` for an entry whose CRC-32 or uncompressed
  size differs from the value recorded in the archive.
- `zip.ts:readZipEntryBuffer` - rejects with `Entry "<name>" not found in zip`
  when the entry is absent.
- `zip.ts:verifyOpenedZipContents` - rejects with `No ZIP stream: <entry>`
  when yauzl returns neither an error nor a stream for an entry. Not exported.
- `zip.ts:readEntryBuffer` - rejects with
  `Failed to open read stream for entry: <entry>` in the same case. Not
  exported.
- `zip.ts:openZip` - an archive that cannot be opened rejects with yauzl's own
  error. `Failed to open zip: <path>` is used only when yauzl returns neither
  an error nor a file. Not exported.

## Side Effects

- `geo.ts:readShapefile` - reads the `.shp` file and the `.dbf` file.
- `geo.ts:readGeoJson` - reads one file.
- `zip.ts:readZipEntryBuffer` - reads the ZIP file.
- `zip.ts:listZipEntries` - reads the ZIP file.
- `zip.ts:verifyZipContentsFromFd` - reads every entry from the caller's file
  descriptor and closes the ZIP file opened on it, when done and on failure.

## Verification

- Run: `npx vitest run test/cli/transform/parse`
