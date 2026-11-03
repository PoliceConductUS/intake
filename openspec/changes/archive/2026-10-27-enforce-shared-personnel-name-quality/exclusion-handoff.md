# Fixture exclusion handoff

The adjacent `fixture-exclusions.json` is an audit packet, not an automatically
loaded policy or a replacement for workspace state. Before the parent INS-69
rebuild, apply each entry using the existing shared CLI:

```text
intake data exclude <namespace> <kind> <key> --reason <reason>
```

Use the parent-approved isolated rebuild workspace. Preserve its existing
exclusions. The CLI appends reason-bearing entries to
`state/<namespace>/excluded.yaml`; the shared transform cascades removals through
foreign keys. Apply the personnel entries as well as the agency entry: removing
an agency alone does not remove its people. No exclusions were applied to a live
or shared workspace by this implementation task.

Evidence inspected read-only on 2026-10-25:

- TCOLE retained acquisition: `command/2026-08-25T22-25-07-031Z-z8jcofzm0onuzg52b3dmsifz/gov.tx.tcole/output/PublicInformationRequest_2025-02-10_1410.xlsx`.
  Officers supplies each PUBLIC_GUID and name; Departments supplies agency 123456.
  Workspace canonical identity mappings independently match the five published
  fixture identities listed in INS-69. Dataset date: 2025-02-10. Original records
  request identifier was not available in the inspected workbook.
- DPSST retained acquisition: `command/2026-10-06T17-53-56-076Z-a0chlbx2o115pj856cnbxrwa/gov.or.dpsst/output/officer-30613-employment-1.html`
  and `officer-30613-certificates-1.html`. Header identifies Test R. Leds and
  ID 30613. Source date is not independently stated; snapshot date is 2026-10-06.
  Canonical mapping: `jtlmvahum9p8h51zqkye9png` → `30613`.
- Fixture status is the parent's reviewed disposition. These source records
  establish identities, not independent proof that a record is synthetic.

The packet excludes no other people by name. Numeric-only fields fail validation;
that failure is not a fixture classification. Unsupported suffixes now fail
visibly instead of being cleared by the Texas transform. Existing bad inputs
must receive an explicit evidence-backed correction or exclusion before a
successful rebuild; this PR does not invent replacements or certify a clean
corpus. Applying curated input corrections is parent rebuild work. Publication
and deployment gates remain unchanged.
