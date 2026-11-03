## Design

IdentityRestoration is a canonical envelope in the existing ordered chain. Its immutable persisted payload is also the recovery receipt. Database key restoration and the applied-event checksum commit together. Forward/reverse canonical ledger IO follows commit; interrupted writes are completed by data up, including for already-applied events. Generation checks completed ledger state. Table/key metadata is generated; PostgreSQL catalogs reject any noncascade incoming reference.

## Trade-off

Filesystem and PostgreSQL cannot share a transaction. Recovery is explicit, deterministic, and fail-loud; the system must not generate new mutations while identity completion is pending.
