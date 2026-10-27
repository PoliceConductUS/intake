# Oregon DPSST Implementation Plan

> Use Superpowers subagent-driven-development with test-first implementation and
> independent review. Implementation was explicitly authorized by the user.

**Goal:** Add a working Oregon public-data source using existing intake contracts.
**Architecture:** Raw HTML acquisition with cookie-bound ASP.NET postbacks, pure
parsers and deterministic transform; shared import handles canonical IDs and writes.
**Tech Stack:** TypeScript, Node fetch, node-html-parser, Vitest; no new packages.
**Spec:** specs/oregon-dpsst/spec.md

## Global Constraints

No invented employment dates, schema changes, dependencies, shared-pipeline special
cases or unchecked writes. Preserve raw inputs and report omissions. All envelopes
use canonical IO. Existing current checkout dependencies are reused by symlink.
`npm run link-seed` is absent on current main; no seed changes are needed here.

## Task 1: Acquisition and parsing

Create sources/gov.or.dpsst/{parse.ts,acquire.ts,client.ts} and focused tests.
Write failing fixture tests first for search parsing and pagination, correct officer
identity, explicit no-data, agency fields and dated detail rows. Implement fetch
session cookies and actual hidden-field postbacks. Save raw files and only mark
manifest complete when all requested pages are acquired. Test failure propagation.

## Task 2: Transform

Create sources/gov.or.dpsst/{transform.ts,employment.ts} and focused tests.
Consume raw HTML through shared source-local parsers and manifest contract. Tests
cover complete episodes, rehire, rank change, missing hire/end, inactive officer,
missing agency, certification actions, duplicate identities and malformed dates.
Transform into existing kinds and validate emitted specs with canonical IO tests.

## Task 3: Review and live verification

Run scoped tests, typecheck, build, OpenSpec validate, formatting and diff checks.
Acquire a bounded real prefix cohort through the new source, transform and generate
against the configured local database. Respect shared eligibility and unresolved
properties; record counts separately for raw, transformed and imported data.
Record failures honestly; no database reset or fabricated corrections.
