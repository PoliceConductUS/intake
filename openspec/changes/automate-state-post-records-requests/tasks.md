## 1. Resolve transport and synchronization contracts

- [x] 1.1 Inspect source lifecycle, canonical IO, manual submission evidence, and Forms API email service.
- [x] 1.2 Research public JustFOIA API availability without assuming vendor integrations expose requester APIs.
- [x] 1.3 Confirm receive mailbox, authentication, pagination/cursors, and attachment access.
- [x] 1.4 Verify email routes or portal adapters for all seven sources.
- [x] 1.5 Specify executable receipt parsing and fulfillment classification using saved evidence fixtures.

## 2. Implement shared request lifecycle

- [x] 2.1 Add strict canonical RecordsRequest IO and durable cuid2 identity with tests.
- [x] 2.2 Add phase-aware source discovery and seven request source definitions.
- [x] 2.3 Import the seven historical submissions without external sends; preserve evidence and date precision.
- [x] 2.4 Implement pure eligibility calculation, atomic per-source reservation, and explicit CLI interval override.
- [x] 2.5 Implement standard request rendering, exact payload snapshots, and Resend submission receipts.
- [x] 2.6 Implement verified portal-only submissions where email is unavailable.

## 3. Synchronize and report

- [x] 3.1 Retrieve and preserve replies and returned files through the selected receive interface.
- [x] 3.2 Correlate internal IDs, provider references, and agency IDs without guessing ambiguous matches.
- [x] 3.3 Report pending, fulfilled, and distinct final dispositions with evidence.
- [x] 3.4 Document CLI usage, environment configuration, and scheduling requirements.

## 4. Verify

- [x] 4.1 Test interval boundary and override, concurrent submissions, retry identity, provider errors, historical import, and phase discovery.
- [x] 4.2 Test acknowledgment, partial production, final production, denial, no records, and ambiguous reply fixtures.
- [x] 4.3 Run focused tests, typecheck, and OpenSpec validation; record actual verification limits.
- [x] 4.4 Complete review and workflow closeout without claiming unconfigured integrations are operational.
