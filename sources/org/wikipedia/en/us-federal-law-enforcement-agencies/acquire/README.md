# us-federal-law-enforcement-agencies/acquire

## Overview

Parsing for the acquire phase of the
`org/wikipedia/en/us-federal-law-enforcement-agencies` source. `parse.ts` turns
the saved HTML of the Wikipedia list page into a list of federal
law-enforcement agency names. It is called by
[`../acquire.ts`](../acquire.ts); see the [source README](../README.md).

## Interface

- `parse.ts:FederalLeList` - type `{ agencies: string[] }`, the parser result.
- `parse.ts:slugify` - `(name: string) => string`. Lower-cases, replaces
  parenthesised text with a space, replaces each run of characters outside
  `[a-z0-9]` with `-`, and strips leading and trailing `-`.
- `parse.ts:parseFederalLeAgencies` - `(html: string) => FederalLeList`. Returns
  the agency names found in the list items of the main section, in document
  order.

## Invariants

- `parse.ts:parseFederalLeAgencies` searches inside `#mw-content-text`, or the
  whole document when that element is absent.
- `parse.ts:parseFederalLeAgencies` reads a `ul` only while it is inside the
  main section. A heading node starts or ends that section by testing its text
  against `parse.ts:MAIN_SECTION` (not exported;
  `/^list of (united states )?federal law enforcement agencies/i`) when its
  level is 2 or less. The level is the number of the first `h1` to `h6` inside
  the node. Headings of level 3 to 6 leave the section unchanged.
- `parse.ts:parseFederalLeAgencies` treats a selected `div` as a heading and a
  selected `ul` as a list. A `div.mw-heading` that holds no `h1` to `h6` throws
  `<source>: heading block with no h1 to h6: <text>`. The page saved on
  2026-09-28 has 26 heading blocks, each with a heading, and no `ul` with an
  `mw-heading` class.
- `parse.ts:parseFederalLeAgencies` takes only the text of the first `<a>` in
  each `<li>`. An item with no link, or with empty link text, is skipped without
  an error.
- `parse.ts:parseFederalLeAgencies` de-duplicates names by `parse.ts:slugify`;
  an item is read once for each `ul` it is inside, and a name seen again is
  kept once. Two different names with one slug throw
  `<source>: agencies <first> and <second> share the slug <slug>`.
- `parse.ts:cleanText` (not exported) removes `[edit]` and `[<digits>]` markers and collapses
  whitespace before a heading or link text is used.
- `parse.ts:parseFederalLeAgencies` returns `{ agencies: [] }` for a page with
  no matching section.

## Side Effects

- None. `parse.ts` works only on the string it is given.

## Verification

- Run: `npx vitest run test/sources/gov.us.federal-le/parse.test.ts`
