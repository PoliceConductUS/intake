# Design

Canonical IDs continue through the existing persisted ledger and current natural-ID contracts. Slug fields are intake-resolved properties: a database slug and cached slug must agree when both exist. Reuse whichever exists and persist database-only values to the canonical property cache. Source input never takes precedence for slugs. Keep the existing Personnel and Agency generation algorithms; other slug-bearing kinds use their reader-facing title/name when a slug must first be assigned, with the same database-aware allocator. Ensure cache hits reserve the slug for the command. Ordinary source-owned properties retain their existing precedence.

Replay rejects changes to the primary key, slug, and LocationPath.path while permitting assertions and unchanged values. Tests exercise actual migrations in disposable PostgreSQL; the repaired shared database is not reset or modified.

Before allocating a new slug, check ownership in persisted canonical slug cache as well as database and command claims. A lazy per-kind read adapter indexes existing slug cache envelopes once per command using canonical IO. This uses the existing property store without introducing a second durable identity ledger. Command claims cover subsequent allocations.
