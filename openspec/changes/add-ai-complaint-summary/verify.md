## Verification

Node 24.21.0. Full `npm run validate` passed: 163 files, 1,631 tests, zero skipped; build, typecheck, formatting and 44 OpenSpec checks passed. Run used two Vitest workers and the explicitly selected rollback-only identity fixture. The generator test harness imports the real summary validator. SQLFluff passed both new migrations. Synthetic unavailable-state contracts reject incomplete evidence.

The migration applied only to the authorized disposable database. A reviewed generated data-chain entry set only the new summary property on one existing case; all prior fields were guarded by checks. Applying through `data up` succeeded, and repeating generation produced an empty diff. Source content and evidence remain in private workspace state. Website validation and combined commit manifest are recorded in the task handoff. No merge, deployment or publication.

Earlier failures are retained in private logs: mise workspace/TMPDIR overrides, concurrent-test timeouts, and the generator test harness missing the new import. These were corrected without weakening assertions. The unchanged intake lockfile install reports transitive deprecations and 13 moderate audit advisories; this local verification does not assert dependency or release clearance.

## Acquisition integration verification

Full intake validation passed: 165 test files, 1,639 tests, typecheck, build, formatting and 44 OpenSpec checks. Synthetic end-to-end coverage invokes ordinary acquire against a cached docket, verifies and retains its PDF, generates a structured summary through the analyzer adapter, and transforms the retained output twice without network/model calls. Seven focused tests cover pagination, missing latest amendment, hash rejection, nonexistent page references, hostile pagination origins, retaining PDFs without extracted text, and analysis reuse.

Live model execution was not performed: the local execution environment has no configured Anthropic API credential. This follows the existing intake AI-provider SDK pattern but does not establish live provider/model availability. Existing private summary corrections and local records were not changed by this code integration.

## Reviewed acquisition replay

All 19 existing private summaries passed the production preparation, review-registration and finish stages using retained source metadata and PDFs. The replay made zero model calls and compared each result to its original summary exactly. This is retained-source replay, not a fresh CourtListener download or a full database reset. Receipt files are stored in the existing source acquisition state; copied source evidence, receipts and results are retained privately under `artifacts/ins115-summary/acquisition-replay`. Existing database corrections remain intact.

Final reviewed-acquisition validation passed: 165 test files, 1,640 tests, build, typecheck, formatting and 44 OpenSpec checks. The local database remained at 551 cases and 19 summaries; all 18 added case pages passed content/citation checks.

## Source-bound unsummarized review validation (2026-11-03)

Added twelve synthetic tests before implementation: all twelve failed because the new registration helper did not exist, while twenty existing acquisition tests passed. After implementation, all 32 summary-acquisition tests passed, including exact paired replay for empty/readable API text, every source-identity/hash binding, wrong prompt and PDF link rejection, and unavailable-source registration rejection. Existing summary and local-extraction receipt tests still pass. The full CourtListener test directory passed all 51 tests across six files. Typecheck, scoped formatting, and all 44 OpenSpec validations passed. Tests used temporary synthetic state only; no production receipts, correction records, or database writes were performed.
