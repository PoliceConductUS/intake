# types

## Overview

Ambient type declarations for packages that ship no types of their own. It
holds one file, `namecase.d.ts`, which declares the untyped `namecase` package
so that the rest of `src/` can import it under the compiler's strict settings.

## Interface

- `namecase.d.ts:declare module "namecase"`: the module declaration.
- `namecase.d.ts:nameCase`: the module's single export,
  `(input: string) => string`, declared with `export =` because the package
  uses `module.exports = fn`.

## Invariants

- None

## Side Effects

- None

## Verification

- Run: `npm run lint` (runs the typecheck that reads this declaration)
