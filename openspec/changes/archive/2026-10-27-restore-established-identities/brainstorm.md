## Outcome

Restore established public identities through a shared auditable workflow.

## Decision

Approved by the coordinating agent from the user's explicit restoration request: use a dedicated event, retain immutable updates, and recover filesystem completion after DB commit. Event-only ledger repair and arbitrary Update rekeying were rejected because they split identity or weaken ordinary invariants.
