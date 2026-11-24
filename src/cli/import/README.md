# import

## Overview

Groups the code that imports a source's `Artifacts` envelope. This directory
has no code of its own and no `index.ts`, so it registers no CLI command.

## Subdirectories & Boundaries

- artifacts: [artifacts/README.md](./artifacts/README.md) - compares an
  `Artifacts` envelope with the database and writes the difference as a
  `DatabaseMutations` envelope; called by `data generate <source>`.
