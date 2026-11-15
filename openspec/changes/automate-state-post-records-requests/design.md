## Context

Intake currently acquires and transforms source evidence. Its catalog requires `transform.ts`; acquisition has no request lifecycle contract or force-submission option. The manual state request campaign has seven confirmed submissions, stored outside the source framework. None is evidence of fulfillment.

The website Forms API sends email using Resend. Receiving mail is a separate integration: current infrastructure documents Google Workspace MX. The user selected Resend for both sending and receiving. Use its received-email API; do not introduce Gmail. Live inspection on 2026-10-24 found mail.policeconduct.org receiving disabled.

## Goals / Non-Goals

**Goals:** register seven submitted states as sources; submit the standard request through email when available or a supported portal transport; apply the 90-day interval with an explicit CLI override; maintain one cuid2 per request; capture agency and transport references; reconcile replies and returned records; report pending and fulfilled requests with evidence.

**Non-Goals:** invent data transforms before responses exist; treat Gmail drafts as submissions; migrate unrelated source state; change the standard request's substance; replace domain mail routing without user direction; count email delivery as fulfillment.

## Decisions

### Source integration

Proposed source namespaces: `gov.ar.clest`, `gov.de.post`, `gov.fl.cjstc`, `gov.ms.bleost`, `gov.sc.letc`, `gov.wv.leps`, and `gov.wi.lesb`. Check for collisions before creating them. Each source owns agency identity, request scope, and verified channel data. Shared pipeline code must not branch on a state or source ID.

Add a supported request phase to source discovery rather than fabricate empty transforms. A shared `requests` command group operates on source request definitions. Proposed commands are `requests submit <source> [--force]`, `requests sync [source]`, and `requests status [source] [--json]`. This keeps sending an explicit action while enabling scheduled CLI execution. Routine data resets must not resend requests implicitly.

### Identity and persisted evidence

Canonical `RecordsRequest` IO owns strict envelope validation and file paths. The intake-owned request service assigns cuid2 before the first external side effect and persists it at `$INTAKE_WORKSPACE/intake/state/namespaces/<source>/RecordsRequest/`. The ID remains unchanged across retries and synchronization. A genuinely new periodic request gets a new ID.

Store the internal ID, source, creation time, submission time, submission evidence, exact rendered payload and attachment digests, transport, provider message ID, agency reference(s), tracking URL, response evidence, and fulfillment state separately. Preserve response bytes and attachments under workspace evidence paths. Record the request ID in outgoing subject/body so ordinary replies can be correlated.

Import each historical confirmed request once with a checked-in cuid2 and original evidence. Retain date precision actually known; do not fabricate times. Preserve Florida reference `GRR-2026-5434` and Mississippi reference `26-3320`. Do not copy access keys into public reports. Retain the original manual status file as provenance.

### Submission pipeline

Stages: load source and history; determine eligibility; render standard request; persist request identity and payload; send through the configured transport; persist receipt. Side effects use narrow IO, clock, ID, transport, and logging adapters. Eligibility and rendering are pure.

Default eligibility is 90 elapsed days since the last confirmed submission for that source. `--force` overrides that interval only. Pending versus fulfilled does not independently change the user-requested interval. The initial import of historical requests prevents an immediate duplicate. A failed validation or preparation does not count as submission. An uncertain transport result remains explicit and must be reconciled before sending another copy of that same request.

Email uses Resend with the full generated standard request attached, the agency-specific scope, requester details, and the configured Resend receiving address as the requested reply contact. The organization contact remains hello@policeconduct.org; historical replies delivered there must be routed into Resend receiving. Use the cuid2 as the provider idempotency key within the provider's documented limits. Persist provider acceptance separately from agency acknowledgment.

Email destinations must be supported by official agency evidence. Verified routes cover Arkansas, Delaware, Florida, Mississippi, West Virginia, and Wisconsin. South Carolina uses its observed Cognito form; no FOIA email route was established. A public website's internal endpoints are not assumed to be a supported API.

### Synchronization and reporting

The selected inbox adapter retrieves replies and attachments without sending mail. Correlate by internal request ID, already-known agency reference, or explicit CLI association; ambiguous replies remain inspectable and cannot silently mutate another request.

Keep submission state separate from fulfillment. Acknowledgments, fee notices, and partial productions remain pending. A fulfillment event needs evidence of the final response and its returned records. Denial or no-records dispositions must remain distinguishable from delivery of records. Preserve the agency's own status text and source evidence when deriving the report's status.

Report internal ID, state/source, submission date, next eligibility date, agency reference, pending/fulfilled state, disposition, and evidence location. The Resend adapter retrieves paginated received messages, raw MIME, and attachments. Structured reply interpretation validates quoted evidence against the response. A final response must establish complete saved production; link-only or incomplete production remains pending. Historical replies without known identifiers can be explicitly associated using paired --request-id and --email-id options.

## Risks / Trade-offs

- Provider acceptance without saved receipt can cause duplicate mail on retry. Persist identity before sending, use provider idempotency, and retain uncertain state for reconciliation.
- Portal acknowledgment is not proof that all requested files were uploaded. Retain separate attachment evidence.
- Portal authentication, CAPTCHA, and changing forms can prevent unattended operation. Record concrete blockers instead of claiming successful automation.
- Replies may omit both internal and agency identifiers. Do not guess a match.
- Existing source state paths differ from current AGENTS.md requirements. New request state follows the documented intake-owned path; no unrelated path migration is part of this feature.

## Migration Plan

Add source definitions and canonical request IO, import the seven prior submission records without network sends, then validate interval and reporting behavior. Implement and test transports against recorded fixtures and injected HTTP adapters. Configure the selected receive-mail integration before claiming end-to-end automation. No Supabase schema or seed change is currently proposed.

## Open Questions

Resend receiving must be configured and verified; use a receive-capable API key. The South Carolina form configuration is based on observed controls and tested through an injected browser adapter; this implementation has not sent a new live request. Existing hello@policeconduct.org correspondence needs routing into the selected Resend receiving address. These operational prerequisites remain explicit.

## Implementation rulings (2026-10-24)

- The user explicitly reiterated Resend for receiving. Synchronize through GET /emails/receiving, retrieve individual messages and attachments, and persist processed message IDs. Do not add a Gmail adapter.
- Provider acceptance counts as submitted for the interval; agency acknowledgment is separate. Historical date-only entries use the end of that recorded UTC date for conservative eligibility, retaining the original precision.
- Source discovery is phase-filtered: request-only entries appear in the catalog and requests commands, not transform/reset/update selection.
- Use the existing Anthropic SDK for structured interpretation of unstructured replies, with quoted evidence checked against the actual response. Preserve ambiguity as pending; final production requires saved response data. This is an implementation choice to make unstructured correspondence automatable.
- Work stays in the existing checkout per the established one-worktree preference; no commits or pushes are part of this request.

### Review refinements

Persist the latest transport attempt timestamp before sending and use that timestamp when reconciling an uncertain attempt. Snapshot portal contact fields with the request payload and reuse them across retries. The portal contact email must match the saved receiving address. Save portal confirmation evidence paths with the request; its local receipt marker is not an agency ID.
