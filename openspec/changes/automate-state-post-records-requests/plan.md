# State POST Records Requests Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. Preserve the current checkout and unrelated changes. Do not commit, push, or send live requests during testing.

**Goal:** Make the seven submitted state sources support periodic, uniquely identified requests and Resend-based response tracking.

**Architecture:** Shared request lifecycle and canonical IO; source request definitions supply verified destinations and historical evidence. Resend handles outbound and inbound mail. Pure eligibility, rendering, correlation and report stages use narrow IO and network adapters.

**Tech Stack:** TypeScript, Commander, Zod, existing cuid2 and Anthropic SDK, native fetch, Vitest, canonical YAML IO.

**Spec:** `specs/records-request-lifecycle/spec.md` and `design.md` in this change.

## Global Constraints

- Default interval is 90 days; explicit `--force` overrides only the interval.
- Preserve request cuid2 across retries; internal, provider and agency IDs are separate.
- Source data, not source-ID dispatch, controls destination and scope.
- New envelopes use canonical IO and intake-owned namespace state.
- No Supabase schema, seed, or production database changes.
- Use Resend for both sending and receiving, as explicitly clarified by the user.

## Review Focus

- Concurrent submit commands must not create duplicate requests.
- An ambiguous timeout must not become a successful receipt or an automatic second send.
- Acknowledgment and partial response must not become fulfilled.
- Pagination and repeat synchronization must not lose or duplicate response evidence.
- Request-only sources must not break existing data phase discovery.

### Task 1: Shared request model, lifecycle and CLI

Files: new `src/shared/io/RecordsRequest.ts`, new `src/cli/requests/` modules; tests under `test/requests/`; update shared IO exports and source catalog discovery as needed.

Source definition contract: `request.ts` exports `request` with `agency`, `state`, `scope`, `channel: {type:'email',to,sourceUrl}` or `{type:'portal',url,sourceUrl}`, and `historical: {id,submittedDate,transport,reference?,trackingUrl?,evidence,notes}[]`. Source namespace is its directory name. Dates are ISO date-only for historical campaign records. Keep portal-only records explicitly unavailable for sending until a verified adapter exists; do not fabricate an API.

- [x] Write failing tests for canonical validation, historical import identity, 90-day boundary/force, concurrency reservation and failure state.
- [x] Run the focused tests and record expected failures before implementation.
- [x] Implement canonical IO, source definition validation, request store and submit/status CLI, preserving exact outgoing content and agency/provider references.
- [x] Read the standard generated request from its existing generator output; do not edit generated documentation manually.
- [x] Add phase-aware catalog tests; request discovery must not change default transform source selection.
- [x] Run focused tests and typecheck, fix failures, and review the changes.

### Task 2: Resend submission and inbound synchronization

Files: `src/cli/requests/resend.ts`, response interpretation/correlation modules, associated tests and CLI sync registration.

Use official Resend `POST /emails`, `GET /emails/receiving`, `GET /emails/receiving/{id}`, and received-attachment endpoints. Keys come from environment, never checked-in source. API request ID is the idempotency key; Resend retains it for 24 hours, so old uncertain sends require reconciliation rather than blind resend. Configure outgoing address and receiving address explicitly. Include the request cuid2 in subject and body.

- [x] Write failing injected-HTTP tests for outbound MIME payload, provider failures, pagination, received messages and attachments.
- [x] Implement Resend adapter and save raw responses/attachments before updating fulfilled state.
- [x] Use structured reply analysis with the existing Anthropic SDK; validate cited evidence against source text. Test acknowledgment, partial production, final production, denial, no records and ambiguous correlation. No outgoing side effect from reply analysis.
- [x] Expose sync and JSON/text status reports; repeat sync is a no-op for already persisted identical messages.
- [x] Run focused tests and typecheck; review and resolve findings.

### Task 3: Seven source definitions and operational configuration

Files: `sources/gov.{ar.clest,de.post,fl.cjstc,ms.bleost,sc.letc,wv.leps,wi.lesb}/request.ts`, request workflow documentation and `.env.example`.

- [x] Verify official email routes; preserve portal route where email is not established.
- [x] Generate historical cuid2 values once and check them into source definitions with original receipt evidence. Do not put secret tracking keys in public source definitions.
- [x] Verify Resend sending/receiving configuration through its supported API. Do not replace the existing root-domain Google Workspace MX.
- [x] Test source catalog and historical report across all seven sources without sending duplicate live requests.
- [x] Document exact configuration and unresolved channel limitations, if any.

### Task 4: Final validation

- [x] Run focused request tests, affected source discovery tests, typecheck and OpenSpec validation.
- [x] Independent review of identity, interval, transport error handling, inbound evidence and requested scope.
- [x] Record actual verification and limitations in verify.md and retrospective.md. Do not claim deployment or complete unattended operation unless proved.
