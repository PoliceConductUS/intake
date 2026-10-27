## Verification

- Focused identity restoration, shared chain, CLI, and existing identity-ledger tests: 30 passed across six files.
- Actual-schema ReviewLink integration: passed with explicit opt-in DATABASE_URL inside a rollback-only transaction. No row or mutation-chain changes persisted.
- TypeScript typecheck: passed.
- Scoped formatting: passed.
- OpenSpec validation: all 42 changes/specifications passed.
- Immutable ordinary Update behavior remains unchanged. Dedicated restoration requires expected erroneous ID, established original ID, reason/evidence, a matching mapping/row, no target collision, and no noncascade incoming FK. Cross-namespace erroneous-ID ownership is rejected.
- Replay tests cover DB reconstruction with already-restored durable identity, DB rollback, applied-receipt checksum drift, and incomplete filesystem completion.

## Limits

No real identity restoration or workspace mutation-chain generation was performed; the coordinating agent must review the concrete event first. No full build or deployment ran. `npm run doctor` reported existing setup gaps including missing `scripts/link-seed.sh`, mise tools, and ignored seed setup; no dependencies were installed.
