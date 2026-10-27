## Design Summary

Requested 2026-10-24: add the already-submitted states as intake sources and automate the public-records request lifecycle. Requests default to a 90-day minimum submission interval, with an explicit CLI override; every request has a durable cuid2; email is preferred using the Forms API's email service; agency-assigned references are retained; reporting distinguishes pending requests from fulfilled requests.

The confirmed submissions are Arkansas, Delaware, Florida, Mississippi, South Carolina, West Virginia, and Wisconsin. The 22 Gmail drafts are unsent and are not historical submissions. Existing evidence is in `records-requests/2026-10-23-state-post/status.json`. Florida's attachment receipt remains unverified. Most other historical forms received the standard source prose without the generated appendices. Preserve these limitations.

This is requirements discovery, not a claim that an implementation or complete design has been approved or delivered. The user's implementation request authorizes the scoped work; the receive provider is Resend per the user clarification below; live receiving configuration remains required.

## Alternatives Considered

### Separate scripts per state

Simple to start, but duplicates submission throttling, identity, tracking, and reporting. Rejected because the lifecycle should behave identically across sources.

### Shared request lifecycle with source-owned destinations

One intake-owned request ledger and CLI; each source describes its agency, scope, supported transport, and verified destination. Email uses Resend, matching the Forms API. Portal transports require verified interfaces and receipt checks. Recommended because it fits source isolation while centralizing request identity and behavior.

### Require a JustFOIA API

Would simplify a subset of portals if a supported requester API is available. Not selected as a prerequisite: public requester API documentation was not found, and the seven sources use multiple platforms. Vendor integrations do not establish public requester API access.

## Agreed Approach

The user explicitly selected email preference, the existing Forms API email service, cuid2 identity, a 90-day default with CLI override, retention of agency references, and pending-versus-fulfilled reporting. The shared lifecycle is the proposed implementation approach, not a separate user requirement.

## Key Decisions

- Forms API outbound service is Resend: `../policeconduct.org/infrastructure/bootstrap-policeconduct/lambdas/forms-api/index.mjs`, `sendVerificationEmail`, calls `POST https://api.resend.com/emails` with `RESEND_API_KEY`.
- Do not call the website's user-verification endpoint to send records requests; use the same provider with a dedicated request message.
- Internal request IDs, email-provider IDs, and agency reference numbers have different meanings and must be stored separately.
- Historical requests must enter the ledger before submission eligibility is evaluated. Do not resend during development or verification.
- Preserve the existing standard request generation process and snapshot the exact outgoing request and attachments.
- Sending, acknowledgment, and fulfillment are different events. An outgoing delivery event must not mark a request fulfilled.
- New request state must use canonical IO and the intake-owned namespace state path required by AGENTS.md.

## Open Questions

- Resolved by user clarification: use Resend for receiving, not a Gmail mailbox adapter.
- The infrastructure documents Google Workspace MX for the domain and a send-only Resend API key. No existing receive-mail integration was found in the inspected Forms API. Use the available full-access Resend key for the receiving API.
- Establish supported automated submission and status interfaces for the remaining portal-only routes; do not invent public API endpoints.

## Research

- JustFOIA product features: https://www.justfoia.com/product-features/ (checked 2026-10-24). Public portal and Laserfiche integration are documented; public requester API access remains unverified.
- Resend inbound: https://resend.com/features/inbound (checked 2026-10-24). Receiving is available, but requires mail routing into Resend; it does not automatically expose an existing Google Workspace inbox.
- Florida official records email: https://www.fdle.state.fl.us/about-fdle/contact-us — `publicrecords@fdle.state.fl.us`.
- Wisconsin official email submission route: https://www.wisdoj.gov/Pages/AboutUs/request-records.aspx — `opengov@wisdoj.gov`.
- Delaware official FOIA coordinator directory: https://delaware.gov/foia-coordinators/ — `DSHS_FOIA@delaware.gov`.

## User clarification (2026-10-24)

Use the same transactional service as the Forms API for receiving as well as sending: Resend. Mailbox-choice question is resolved. Live provider configuration has receiving disabled on mail.policeconduct.org; implementation must use the Resend inbound API and expose receiving configuration requirements.
