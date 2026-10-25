# Oregon DPSST — public CJ IRIS

Source: [Oregon DPSST public records](https://www.oregon.gov/dpsst/CJ/Pages/PublicRecords.aspx)
and [CJ IRIS](https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeSearch.aspx).

This source collects agencies, personnel, dated employment history and
certifications. It uses the public search form and ordinary session cookies;
no account or records request is required. Training and education are not part
of this source's initial implementation.

## Run

```sh
npm run cli -- data acquire gov.or.dpsst
npm run cli -- data transform gov.or.dpsst
npm run cli -- data generate gov.or.dpsst
npm run cli -- data up
npm run cli -- data verify
```

Acquisition searches A–Z and follows pagination. Interrupted acquisitions resume through the CLI: completed search prefixes,
officer detail sets and agency responses are validated and reused. Incomplete
units are fetched again. A changed prefix scope requires a fresh acquisition. For a targeted verification run:

```sh
OREGON_DPSST_PREFIXES=Z npm run cli -- data acquire gov.or.dpsst
```

A targeted run is not a statewide dataset. The acquisition manifest records its
prefixes and referenced raw HTML. `complete` means the configured acquisition
finished; it does not prove the public site contains every Oregon officer. DPSST
states that the public system generally covers people employed within the last
five years and is updated nightly.

## Meaning and identity

- DPSST numbers identify people; agency codes identify organizations.
- Explicit hire dates identify employment episodes. Promotions, leave and rank
  changes do not invent new hire dates. Missing or ambiguous employment evidence
  is reported and remains inspectable in the raw pages.
- Certificate type and level identify a license type. Source status dates produce
  license actions; certification status is separate from employment status.
- Expiration and probation dates remain in raw evidence because existing license
  fields cannot represent them. No schema fields or dates are fabricated.
- Agency addresses and contacts remain source data; shared intake validation,
  geocoding, place containment and identity mapping apply during generation.

The source contains other public-safety disciplines as well as police. Raw source
records are retained even when the shared import rules do not admit them. An
explicit missing agency response or an unresolved employment episode must not be
mistaken for a fully imported record. Inspect command logs and compare acquired,
transformed and applied counts.
