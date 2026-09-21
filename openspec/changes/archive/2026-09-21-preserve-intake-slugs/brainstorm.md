# Preserve intake identities and URLs

## Outcome

Loading intake data preserves canonical IDs and published slugs. The user explicitly requested this bug fix and correction of 129,924 same-ID personnel URLs.

## Evidence

Personnel transformation generates a name plus ID suffix when the canonical property cache is empty. Producer slugs are not authoritative for system URLs. Planning can update existing rows with replacement slugs. The reference-20260814 CSV backup contains the old IDs and slugs.

## Approach

Preserve existing database slugs by exact canonical ID, reuse cached slugs after resets, and let intake assign unique slugs only for genuinely new canonical records. Producer fields cannot assign system slugs. Correct known bad cache/database values from the exact-ID reference backup with retained before/after evidence. No name-based identity merges.

## Authorization

The direct fix request and AGENTS.md authorize scoped implementation without a second design approval. No deployment is requested.
