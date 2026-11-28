# photo

## Overview

Registers `photo import <personnel-id> <file>` with `--source-url <url>`. It
stores a local portrait in the workspace and appends a `PersonnelPhoto` record
to the manual records of the namespace `org/policeconduct/manual`. The record
reaches the database later through `data transform`, `data generate` and
`data up` for that namespace.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; registers
  `photo import`.
- `prepare.ts:preparePersonnelPhoto` -
  `(personnelId, filename, adapters, sourceUrl?)` returns
  `{ kind: "PersonnelPhoto", record }`. The adapters are `findPersonnel`,
  `sourceIdFor`, `read` and `write`.
- `store.ts:readPersonnelPhoto` - `(filename)` returns `{ bytes, photo }`,
  where `photo` is
  `{ workspace_path, sha256, content_type, byte_size, source_filename }`.
- `store.ts:writePersonnelPhoto` - `(workspace, workspacePath, bytes)`.

## Invariants

- `index.ts:registerCliCommand` - exit code 1 when `DATABASE_URL` is blank or
  `--source-url` is not a valid URL.
- `prepare.ts:preparePersonnelPhoto` - throws `Personnel not found` when
  `findPersonnel` returns false. The record is parsed with
  `PersonnelPhotoSpec`, and its `id` and `personnel_id` are the namespace's
  source ID for the person, not the canonical ID.
- `store.ts:imageType` (not exported) - throws unless the bytes are WebP,
  PNG, JPEG or AVIF.
- `prepare.ts:preparePersonnelPhoto` - the image is read, its type is
  checked and the record is parsed before `write` is called, so an invalid
  image or record writes no image file.
- `index.ts:registerCliCommand` - the image is written before the command
  directory is created and before `appendEntry`. A failure in one of those
  two steps leaves the image file in the workspace.

## Side Effects

- `index.ts:registerCliCommand` - reads the workspace through
  `intakeWorkspace` (`INTAKE_WORKSPACE`) and
  reads `DATABASE_URL`; `select` on `public.personnel`; `ledger.sourceIdFor` may
  write a `SourceNameToCanonicalId` ledger record; creates a command
  directory and opens its command log with no terminal; appends to the manual
  records through `appendEntry`; records a caught error as the log's last
  record and closes the log when the command ends.
- `store.ts:readPersonnelPhoto` - reads the image file.
- `store.ts:writePersonnelPhoto` - writes
  `<workspace>/assets/PersonnelPhoto/<sha256>.<extension>`.

## Verification

- Run: `npx vitest run test/cli/personnel-photo.test.ts`
