# Outcome and scope

The user requested a database snapshot, reset, and exact comparison. The reset exposed retained Minnesota summary results that no longer match the required analysis contract. The user requires current prompts only, asked why older results were reachable, and asked to separate prompt text from code.

The selected fix separates the current Minnesota prompt into a text file, fingerprints its exact contents, and rejects noncurrent completed results. Existing retained automatic inputs are transformed for validation before reset, then transformed again in the rebuilt database to preserve dependency semantics. Fresh acquisition retains its existing dependency order. A malformed pointer cannot count as a missing pointer.

The user chose exact prompt verification and metadata conversion for the 531 existing version-2 summaries. The exact prompt text matches its version-2 introduction. All 70 retained version-1 PDF hashes have current results available; reuse those current results rather than obsolete analyses. Raw source PDFs and originals remain private. No database schema, public narrative shape or publication behavior changes.

Implementation remains in the existing worktree and branch. The private backup and source rebuild are operational work; neither private data nor local paths belong in this change.
