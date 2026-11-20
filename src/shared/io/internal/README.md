# internal

## Overview

YAML document reading, parsing, writing, and digesting shared by every
envelope IO. The envelope IO modules in [`../`](../README.md), the generated
artifact IO in `../generated/`, and the envelope IO
under `src/cli/` (state and mutation envelopes) call these functions to read,
parse, and write YAML files. Two modules in `../` also do file work of their
own: `../excluded-records.ts` uses `yaml` and `node:fs/promises` directly for
`excluded.yaml`, which is not an envelope, and `../RecordsRequest.ts` calls
`rename` to replace the file it wrote. The functions return an untyped
document; the calling IO validates it against that kind's schema.

## Interface

- `yaml-document.ts:parseYamlDocument(filePath, contents, label)` parses YAML
  text and returns the document as plain JSON data (`unknown`).
- `yaml-document.ts:readYamlDocumentFile(filePath, label)` reads a file as
  UTF-8 and returns `{ contents, document }`: the raw text and the parsed
  document.
- `yaml-document.ts:writeYamlDocumentFile(filePath, value)` serializes `value`
  to YAML, writes it, and returns the written text.
- `yaml-document.ts:readYamlDocumentDigest(filePath, label)` reads and parses
  a file and returns `sha256:<hex>` of its raw text, using
  `../resource.ts:yamlDigest`.

## Invariants

- `yaml-document.ts:parseYamlDocument` throws
  `<label> YAML is malformed: <filePath>: <parser error message>` on the first
  YAML parse error; it never returns a partial document.
- `yaml-document.ts:parseYamlDocument` parses with `uniqueKeys: false`, so a
  duplicate map key is not rejected here.
- `yaml-document.ts:readYamlDocumentFile` throws
  `<label> is not a file: <filePath>` when the path is a directory (`EISDIR`)
  and `<label> is not readable: <filePath>` for any other read failure.
- `yaml-document.ts:readYamlDocumentDigest` parses the file before digesting,
  so a malformed file fails instead of producing a digest.

## Side Effects

- `yaml-document.ts:readYamlDocumentFile` reads a file from disk
  (`readFile`).
- `yaml-document.ts:writeYamlDocumentFile` creates the parent directory
  recursively (`mkdir`) and writes or overwrites the file (`writeFile`).

## Verification

- Run: `npx vitest run test/shared/io`
