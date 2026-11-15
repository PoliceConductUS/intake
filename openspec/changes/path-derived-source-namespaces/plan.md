## Implementation order

1. Record a complete source mapping and a baseline of namespace-dependent files, checksums, database IDs and slugs. Confirm the namespace root and naming of internally assembled sources.
2. Add regression cases covering source discovery and selection from nested marker files. Move the modules and update the shared CLI loaders and Action entry point.
3. Update state and command writers and readers together. Exercise command restoration and prior-acquisition selection against a copy with nested source namespaces.
4. Migrate the retained workspace through Intake's workspace interfaces. Verify the identity ledgers, raw inputs and checksum chains before the active database rebuild.
5. Run the no-acquire reset, compare the result with the baseline, and run website and Intake validation in the existing worktrees.
