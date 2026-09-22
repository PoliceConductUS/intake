# CLI record exclusions

Add `data exclude <source> <kind> <source-id> --reason <reason>` to author the existing source exclusion list. Operators can exclude a known invalid source record without editing YAML. Use the existing transform exclusion and foreign-key cascade rather than introducing a second filtering mechanism.

Exclusions apply on the next transform and survive resets in `sources/<source>/excluded.yaml`. Already generated artifacts and database rows are not changed by this command. No schema migration or database reset is required; regenerate artifacts before generating mutations.
