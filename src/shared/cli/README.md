# cli

## Overview

The contract between the `intake` command-line program and its command
folders. A command folder exports a `registerCliCommand` function from its
`index` module; `registerDiscoveredCommands` finds those folders and calls
each one with the parent `commander` command. `src/cli/run-intake.ts` uses it
to build the top-level program and `src/cli/replay/index.ts` uses it for the
`replay` subcommands.

## Interface

- `types.ts:CommandResult` is the result of a command: `exitCode` plus
  optional `stdout` and `stderr` text.
- `types.ts:CliCommandDependencies` is what a command folder receives when it
  registers: the required `setResult(result)` callback and the optional
  `useInitialAgencyRoots`, `keepCachedCallResults`,
  `runImportArtifactsCommand`, and
  `runReplayDatabaseMutationsCommand` overrides.
- `types.ts:RegisterCliCommand` is the signature a command folder exports as
  `registerCliCommand`: `(command, dependencies) => void | Promise<void>`.
- `command-discovery.ts:registerDiscoveredCommands(parentCommand, directory, dependencies)`
  registers every command folder directly under `directory` on
  `parentCommand`.

## Invariants

- `command-discovery.ts:registerDiscoveredCommands` considers only direct
  child directories of `directory`, and skips a directory that has neither an
  `index.js` nor an `index.ts` file.
- `command-discovery.ts:registerDiscoveredCommands` always imports
  `<directory>/<entry>/index.js`, including when only `index.ts` exists on
  disk.
- `command-discovery.ts:registerDiscoveredCommands` calls
  `registerCliCommand` only when the imported module exports it as a
  function; a module without it is skipped without an error.
- `command-discovery.ts:registerDiscoveredCommands` awaits each registration
  in turn, in the order `readdir` returns the entries.

## Side Effects

- `command-discovery.ts:registerDiscoveredCommands` reads the file system
  (`readdir`, `stat`) and dynamically imports each command folder's `index`
  module, which runs that module's top-level code.
- `command-discovery.ts:registerDiscoveredCommands` mutates `parentCommand`
  through each imported `registerCliCommand`.
- `types.ts`: None.

## Verification

- Run: `npx vitest run test/cli.test.ts`
