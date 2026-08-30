# ADR 0031: A Model-Driven Manual Curation Source

## Status

Proposed

## Context

Some data can only come from a human: a curated location alias that fixes a
misspelling (so the alias-aware place snap resolves it), a hand-added link, a
correction. Rather than a bespoke source per case, one **type-independent** source
can interview a human to create a record of **any** kind, because the record model
is already shared.

The generated entity model — `<Kind>Spec` (the fields), `FK_REFERENCES` (which
fields are foreign keys and their target kind), and the registry's identity column
per kind — fully describes what to ask and how to key a record. So the interview
can be **model-driven**, and the record it builds flows through the ordinary
import facades (resolve-or-fail on FKs, natural-key or minted identity) with no new
resolution code.

## Decision

Add a source `org.policeconduct.manual`.

**acquire is a model-driven interview.** It reads the shared model for the chosen
kind (`describeKind`) and prompts for each field — marking optional fields and, for
a foreign key, naming the target kind so the human supplies its **source id**
(`namespace · Kind · SourceId`, exactly what the FK resolvers already consume). The
built record is validated against the kind's spec, then appended to an append-only
chain: each immutable output (named by its content hash) carries the full entry
list plus the previous output's **path + sha256**, so any out-of-band edit fails
loud. Entries dedupe by `(kind, identity)` — a repeated record updates in place. A
non-interactive path (`MANUAL_KIND` / `MANUAL_RECORD`) exists for scripts and
tests.

**run emits the latest as artifacts.** It groups the curated records by kind and
emits each as its artifact kind, keyed by the record's identity column. Import
resolves FKs and identity as for any other source, so validation ("canonical
exists," "not a duplicate") comes free from resolve-or-fail + natural-key identity.

**LocationPathAlias is the first handled kind** — a curated `alias_path →
location_path_id` that feeds the alias-aware snap.

## Consequences

- One source curates any kind; adding a kind is a one-line change to the handled
  set (`HANDLED_RECORD_KINDS`), no new interview or emission code — it is driven by
  the shared model.
- The interview never hand-transforms a record (honours the facade/model rule):
  the model dictates the fields, import dictates resolution.
- Two known limits, deferred: a source's `produces` must be **static** for run
  ordering, so the handled set is declared rather than fully open; and **updating
  canonical-identity records** (Agency, Personnel) has no human-enterable key, so
  only creates and natural-key kinds are in scope now.
- Gated behind the full reconstruction rebuild like every source.

## Alternatives Considered

- **A bespoke source per curated kind** (the original location-alias source).
  Rejected: the model already describes every kind, so one model-driven source
  subsumes them.
- **A hand-edited data file.** Rejected: no capture UX, no integrity chain, easy to
  malform against the spec.

## Revisit Trigger

Canonical-identity records need curated updates (requires a human-stable key or a
picker), or `produces` needs to be dynamic to open the handled set fully.
