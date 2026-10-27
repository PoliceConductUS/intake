# State records requests

The `requests` CLI tracks the seven confirmed state submissions from
`records-requests/2026-10-23-state-post/status.json`. Each source has a checked-in
cuid2 for its historical request. Importing history does not send anything.

| Source          | New submission route                  |
| --------------- | ------------------------------------- |
| `gov.ar.clest`  | CLEST recordskeeping assistant, email |
| `gov.de.post`   | DSHS FOIA coordinator, email          |
| `gov.fl.cjstc`  | FDLE public records custodian, email  |
| `gov.ms.bleost` | DPS records contact, email            |
| `gov.sc.letc`   | Criminal Justice Academy Cognito form |
| `gov.wi.lesb`   | DOJ Office of Open Government, email  |
| `gov.wv.leps`   | LEPS program manager, email           |

Each `sources/<source>/request.ts` records the official destination evidence.
Arkansas and West Virginia use published program contacts, not dedicated FOIA
inboxes. Historical submissions retain their original portal transport even
where subsequent submissions use email. Florida's `GRR-2026-5434` and
Mississippi's `26-3320` remain separate from internal cuid2 IDs.

## Commands

```sh
npm run cli -- requests status --json
npm run cli -- requests submit gov.fl.cjstc
npm run cli -- requests submit gov.fl.cjstc --force
npm run cli -- requests sync
```

The default interval is 90 elapsed days after the most recent confirmed
submission for that source. Date-only historical evidence uses the end of the
recorded UTC date for eligibility. `--force` overrides the interval. It does not
override an unresolved submission outcome. A definitive rejection can be retried
with the same ID and saved content; an uncertain result requires reconciliation.

The outgoing request includes the source's scope and the complete generated
`docs/data-request-format.md`. Change its generator templates, not that generated
file. Email attaches the standard request; the portal includes its full text in
the request field and checks the filled fields before submitting.

Ordinary import, transform, and reset commands do not submit requests. To run
periodically, invoke `submit` for each request source and `sync` from your existing
scheduler. An ineligible submission exits with an explanatory error. This change
does not install a scheduler.

## Resend configuration

Both sending and receiving use **Resend**, the same transactional service as the
website Forms API. There is no Gmail API integration.

- `INTAKE_WORKSPACE`: durable workspace, shared across scheduled executions.
- `RESEND_API_KEY`: sending key, as used by the Forms API.
- `RESEND_API_KEY_FULL_ACCESS`: key with access to received emails and attachments.
- `RECORDS_REQUEST_FROM`: sender authorized by the Resend sending domain.
- `RECORDS_REQUEST_RECEIVING_ADDRESS`: address routed into Resend receiving;
  used as the email Reply-To and by synchronization.
- `RECORDS_REQUEST_REQUESTER`: requester signature, including organization,
  postal address, phone, and public email.
- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`: structured interpretation of agency
  correspondence. Interpretation cannot send messages.
- `RECORDS_REQUEST_CONTACT`: JSON contact for the portal, with `firstName`,
  `lastName`, `email`, `phone`, `organization`, `street`, `city`, `state`, and `zip`.
  Its email must equal `RECORDS_REQUEST_RECEIVING_ADDRESS`.

The South Carolina form configuration currently selects Texas, matching the
provided Austin address. Its portal requires the existing optional Playwright
dependency and an installed Chromium browser.

Live inspection on 2026-10-24 found receiving **disabled** on
`mail.policeconduct.org`. Root-domain mail currently uses Google Workspace.
Enable a Resend receiving route and configure the environment before running
live synchronization. Existing requests and the standard public contact use
`hello@policeconduct.org`; those replies must also be delivered or forwarded into
the selected Resend receiving address to be tracked. The CLI cannot retrieve
messages that were delivered only to Google Workspace. No DNS or forwarding
configuration was changed by this implementation.

## Evidence and fulfillment

Canonical `RecordsRequest` envelopes live under
`$INTAKE_WORKSPACE/intake/state/namespaces/<source>/RecordsRequest/`.
Received JSON, raw MIME, and attachment bytes are retained under
`$INTAKE_WORKSPACE/intake/state/records-request-inbox/`. Preserve the workspace
between executions; it contains identity, cooldown, and response evidence.

Replies correlate using the internal request ID or an agency reference already
associated with the request. An ambiguous or unmatched reply is saved and
reported without guessing. For historical correspondence lacking these IDs,
explicitly associate the received Resend message:

```sh
npm run cli -- requests sync gov.ar.clest --request-id <cuid2> --email-id <resend-received-id>
```

Acknowledgments, fees, and partial productions remain pending. Fulfillment
requires a quoted final-production statement establishing that all produced records
are represented by saved attachments, including earlier partial productions.
Synchronization analyzes each new batch chronologically so prior production is
available when interpreting a later closure. Denials and no-records
responses are reported separately. Link-only productions remain pending: this
implementation saves received attachments, not arbitrary portal downloads.

The seven historical entries begin pending. Their submission confirmations do
not establish fulfillment. A portal receipt marker identifies saved confirmation
evidence; it is not an agency-assigned request number.

## JustFOIA

[JustFOIA documents public portals and agency integrations](https://www.justfoia.com/product-features/),
but a supported public requester API for submission and status was not verified.
FDLE publishes an email records route, so this source uses that route rather than
depending on undocumented JustFOIA endpoints.
