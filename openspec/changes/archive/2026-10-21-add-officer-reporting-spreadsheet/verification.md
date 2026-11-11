# Verification

2026-10-15, local development workspace `../intake-workspace/dev-copy` and PostgreSQL
at `127.0.0.1:54322`. User confirmed: link existing officers and report missing
records; do not create missing officers.

## Evidence and results

- Preserved original workbook and acquisition snapshot; all 354 linked rows
  represented across 350 distinct URLs.
- Attempted every URL. Retrieval failures: 67 HTTP 403, six HTTP 404, four HTTP
  402, two HTTP 429, two network failures.
- Reviewed all 269 successful responses against named subjects and employing
  agencies. Preserved source/name/state discrepancies in `review-notes.json`.
- 246 articles support 250 officer/employer records; 23 responses do not support
  an identity. Every reviewed passage is checked against the preserved response
  body, and every reviewed response digest is checked during transformation.
- Shared resolvers prepared 11 CoverageLinks and 13 CoverageLinkAgencyPersonnel
  associations, covering 12 distinct canonical personnel records. Read-only
  verification followed each persisted mapping to its exact database record and
  confirmed the agency state.
- Unresolved identity counts: 218 agency-unresolved, ten officer-unresolved,
  nine agency-state-unverified. These are officer/employer counts, not mutually
  exclusive article counts.

## Checks

- Source tests and existing PoliceActivity transform tests: nine tests passed.
- `npm run typecheck`: passed.
- `npm run openspec:validate`: 39 items passed.
- Real `data acquire` and `data transform`: completed with explicit unresolved
  records in the source-state mapping report.

## Database import

Restored migrations `20261006000000` and `20261010000000` from the existing
Oregon worktree after matching their SQL with the applied database history.
Regenerated envelope migration metadata. All 38 local/remote migration versions
match. Both restored migrations also passed a rollback-only DDL check in an
isolated schema (16 expected columns and no generated ID defaults). No reset or
seed reload was performed because the database already contained these migrations.

The default `dev` workspace does not match this database's applied history.
Its un-applied trial `000002` was moved to `.cache/unapplied-dev-mutations/`.
Used the matching `dev-copy` workspace and the existing newer Oregon runtime,
which supports all kinds already present in that history. No unrelated runtime
changes were copied into this checkout. From this checkout, commands used:

```bash
mise exec -- env INTAKE_WORKSPACE=/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy node --max-old-space-size=12288 --import tsx /Users/dalelotts/.codex/worktrees/oregon-dpsst/intake/src/cli/index.ts data verify
```

The same entrypoint ran `data acquire ... --from-local <preserved-output>`,
`data transform us-officer-sex-crime-reporting`, `data generate
us-officer-sex-crime-reporting`, and `data up --to 000018`.

- Existing history verified before import; all 18 applied entries also verified
  after import.
- Repeat generation compared source values with stored records and returned
  `empty diff, nothing appended`.
- Applied `000018-us-officer-sex-crime-reporting.DatabaseMutations.yaml`:
  11 CoverageLinkCreate and 13 CoverageLinkAgencyPersonnelCreate mutations only.
- Read the new envelope through canonical DatabaseMutations IO, then compared
  every supplied field against its exact stored database row: all 24 passed.
- All 13 associations independently verified against canonical personnel and
  agency records, covering 12 distinct existing officers. No officers created.

Evidence and unresolved records remain under
`../intake-workspace/dev-copy/state/us-officer-sex-crime-reporting/` in
`mapping-report.json` and `verified-mappings.json`.

## 2026-10-18 agency-resolution audit

Queried all 3,538 agency records in the same local database: TX 2,883, MN 394,
OR 237, DC 17, VA 5, IL 1, WA 1. The 24 records outside TX/MN/OR are federal
or railroad agencies, not general state/local rosters.

Reviewed the original 218 unresolved officer/employer pairs:

- 189 non-federal pairs concern states with no agency rows.
- 18 lack the named agency among the existing records in their state.
- Five federal employer/office descriptions are not equivalent to the stored
  headquarters records; headquarters address state is not employment location.
- Five were abbreviation mismatches: Hennepin, Mille Lacs, and Wright county
  sheriffs; Fairmont Police; Magnolia Police. Corrected the reviewed agency
  names to the exact existing names with explicit notes, preserving raw source
  and article passages. No qualifying personnel matches exist in those five
  agency rosters. A direct surname search also did not establish those identities.
- One article identifies only Clackamas County; both sheriff and communications
  agencies exist, so the agency remains ambiguous.

Staged the corrected review through shared `data acquire --from-local` and ran
`data transform`. The five corrected agencies now resolve; counts are 213
agency-unresolved, 15 officer-unresolved, nine agency-state-unverified, and
13 mapped officer/employer pairs. The nine state failures are actual namesakes
in other states, not missing street-address fields. Four source tests and all
40 OpenSpec checks passed. Repeat database generation returned `empty diff,
nothing appended`; no additional coverage or personnel records were written.

Detailed audit: `../intake-workspace/dev-copy/state/us-officer-sex-crime-reporting/agency-resolution-audit.json`.
