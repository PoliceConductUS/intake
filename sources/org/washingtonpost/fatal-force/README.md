# Washington Post Fatal Force v2

Imports both v2 CSVs as attributed source reports. The default pin is
`cb0fb99586ec3a820c7aa0824acfb190037de106`; `FATAL_FORCE_COMMIT` accepts a full
40-character lowercase SHA. Moving branch refs are rejected.

With `DATABASE_URL` pointing at a migrated development database and
`INTAKE_WORKSPACE` pointing outside the repository:

```sh
npm run cli -- data acquire org/washingtonpost/fatal-force
npm run cli -- data transform org/washingtonpost/fatal-force
npm run cli -- data generate org/washingtonpost/fatal-force
npm run cli -- data up
```

Acquire preserves raw bytes and file provenance, verifies checksums before
reuse, and reuses prior acquisitions for an unchanged pin. Transform validates
CSV columns, source IDs, numbers, booleans, dates, and nonempty agency references.
Root intake assigns canonical IDs and records every database mutation. Repeating
generate after apply compares all fields and produces an empty diff.

`FatalShooting` stores the incident and source claims. `FatalShootingAgency`
stores the reported department grouping, verbatim ORI list, and reported total.
Its canonical `agency_id` remains null. No canonical agency or personnel is
created. `reported_agency_ids` contains source-local IDs scoped to
`source_dataset`, not canonical IDs. Empty values remain null. Neither a missing
name nor a missing agency list causes an incident to be dropped.

Every row includes source URL, full commit, SHA-256, retrieval time, source record
ID, licence, redistribution class, and `evidence_status: source_reported`.
Contested attributes remain attributed reports, not independent findings.
No public page or export is introduced. Raw files and real-person fixtures must
never be committed.

Verification at the default pin (2026-11-14): 10,430 incidents, 3,727 reported
agencies; annual counts 2015–2024 are 995, 959, 984, 992, 993, 1021, 1050, 1097,
1164, 1175. Incident 10562 has no reported agency list. Thirteen reported agency
totals differ from incident-link counts; transform logs each discrepancy and
preserves the reported total unchanged. The two source files are retained as
evidence of that disagreement.

Source: [The Washington Post, Fatal Force](https://github.com/washingtonpost/data-police-shootings),
licence CC BY-NC-SA 4.0. The data describes fatal police shootings, not every death
in custody or every use of force. The test suite uses synthetic records only.
