# replay

## Overview

Registers the `replay` command group. `index.ts` adds no subcommand itself:
it calls `registerDiscoveredCommands`, which loads the `index` module of each
subdirectory that contains `index.js` or `index.ts` and calls its
`registerCliCommand` export when it has one.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; registers
  `replay` and the subcommands found in its subdirectories.
- [database-mutations](./database-mutations/README.md) -
  `replay database-mutations <database-mutations-ref>`: runs an existing
  `DatabaseMutations` file against the database in one transaction.

## Invariants

- None.

## Side Effects

- `index.ts:registerCliCommand` - `registerDiscoveredCommands` lists this
  directory and imports the `index` module of each subdirectory that contains
  `index.js` or `index.ts`.

## Verification

- Run: `npx vitest run test/cli.test.ts`
