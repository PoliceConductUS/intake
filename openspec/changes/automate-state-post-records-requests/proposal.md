## Why

The state POST request campaign currently relies on manual form submissions and a local status file. Intake cannot enforce a repeat interval, correlate replies to durable request IDs, or report fulfillment. A shared request lifecycle will make the seven already-submitted state sources repeatable and trackable without losing prior submission evidence.

## What Changes

- Add request-capable sources for Arkansas, Delaware, Florida, Mississippi, South Carolina, West Virginia, and Wisconsin.
- Add intake-owned cuid2 request records and import the seven prior confirmed submissions without resending them.
- Enforce a default 90-day submission interval per source, with an explicit CLI override.
- Prefer verified email submission routes using Resend, the Forms API's provider, with the complete standard request attached.
- Track provider IDs, agency reference numbers, submission receipts, incoming responses, returned records, and fulfillment separately.
- Add request submission, synchronization, and status reporting commands. Source discovery must distinguish phases so request-only sources do not enter data transformation or reset pipelines.

## Capabilities

### New Capabilities

- `records-request-lifecycle`: request-capable sources, periodic submission eligibility, durable identity, transport receipts, response synchronization, and fulfillment reporting.

### Modified Capabilities

None identified in the current durable specifications. The source catalog implementation needs phase-aware discovery, specified within the new capability.

## Impact

Affected areas: source discovery/catalog, new source request definitions, CLI registration, canonical request IO, workspace request evidence, Resend transport, selected receive-mail integration, and request tests/docs. Existing standard request generation remains authoritative.

No Supabase migrations, seed rows, downstream application database contracts, database reset, or production database migration are proposed. A new handwritten canonical IO module does not require regenerating unrelated entity types. Mailbox authentication and the four remaining submission channels must be resolved before end-to-end automation can be claimed.
