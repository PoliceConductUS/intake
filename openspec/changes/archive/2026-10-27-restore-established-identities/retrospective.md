## Outcome

A dedicated shared identity-restoration event preserves ordinary immutable-update semantics and records corrections without rewriting applied history. Event generation changes neither database identity nor ledger state. After the DB transaction and applied receipt commit, canonical atomic-per-file IO completes the forward/reverse ledger; data up recovers interrupted completion.

## Verification lesson

Mock DB tests initially missed that generated table metadata already includes the public schema. Exact qualified-SQL assertions and a successful real-schema rollback-only test now cover that boundary. The initial primary-checkout assumption was corrected by moving only owned new files into the existing active Oregon worktree; the primary checkout was returned clean and unrelated work preserved.
