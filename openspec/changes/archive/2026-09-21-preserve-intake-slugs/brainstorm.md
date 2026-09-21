# Preserve intake slugs

The user requires existing intake IDs and public slugs to survive loading and explicitly designates redesign-config-driven-intake as the implementation branch. Producer slugs cannot establish uniqueness in intake. Adapt the correction to the current facade/cache/replay architecture; do not transplant obsolete main table contracts.

Use the canonical identity ledger unchanged. Resolve slugs from established database/cache values, fail on disagreement, and generate unique intake-owned values only for new identities. Keep name corrections independent of URL identity. Existing LocationPath paths are also immutable during replay.
