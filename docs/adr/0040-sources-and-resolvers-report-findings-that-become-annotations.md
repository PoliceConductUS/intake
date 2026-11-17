# ADR 0040: Sources and Resolvers Report Findings That Become Annotations

## Status

Proposed

> Proposed with the OpenSpec change `move-complaint-summaries-to-generate`. Adds
> to **ADR 0034**: a record's metadata gains `defects` and is passed through the
> pipeline whole. Describes annotation identity and resolution, which no earlier
> ADR recorded. **ADR 0038** proposes a later, typed shape for the same
> annotations.

## Context

An annotation is a database record attached to another record. It reports a
problem with a source's data: a type (warning, error or correction), a field, a
value, a message and evidence.

Today the shared import derives annotations in `data generate` from two groups of
findings per record: corrections that were applied, and validation of the record's
final values. Each finding becomes a `DataAnnotation` record whose name is a hash
of the subject record, the group, the finding's key, the source namespace and the
source record ID. Its ID comes from that name through the source-name mapping (ADR
0008), so it is the same on every run. For each record a source emits, an active
annotation that the current findings no longer produce is written as resolved.

Two things cannot report a finding:

- **A source.** When a source knows something is wrong with one of its records, it
  has no field to say so.
- **A resolver.** A resolver returns a value or throws. One document that cannot
  be downloaded can therefore only stop the whole command.

A record's metadata is also copied field by field (`name`, `action`, `selector`)
in five places between the transform and the import, so a new metadata field is
dropped unless all five are changed.

## Decision

**A source and a resolver can each report a finding about a record, and the shared
import turns it into an annotation by the rules it already uses.**

**1. A finding.** A finding has a code, a type (warning or error), a field, a
value, a plain-English message, optional evidence, and the source namespace and
source record ID it is about. The code names the sort of problem and stays the
same when the wording changes.

**2. A source reports through `metadata.defects`.** A record in an artifact may
carry a list of findings in its metadata. A finding's source record ID may differ
from the record's own: a record for a licensing authority can carry findings about
several dockets, each with its docket as the source record ID.

**3. A resolver reports through its context.** A resolver may report a finding and
return no value. The command continues.

**4. Two more groups, same rules.** Source findings and resolver findings are two
more groups beside corrections and validation. A finding's key is its code and
field. Because the name already includes the source record ID, two findings with
the same code about two dockets are two annotations, each with a stable ID.

**5. Resolution is unchanged.** When a record is emitted again and a finding is no
longer reported, its annotation is written as resolved. A source that reports
findings on a record therefore emits that record whenever it runs, with an empty
list when there are none.

**6. Metadata is validated once and passed whole.** A record's metadata is checked
against its strict schema where it is read and then handed on as one object. No
later step picks fields out of it.

**7. A kind that cannot hold annotations fails.** A finding on a record whose kind
does not take part in annotations is an error, not a silent drop.

## Consequences

- One bad document produces a warning on one record instead of a failed command.
- The number of annotations grows with the number of problems found. They are
  public on policeconduct.org.
- Messages are written by intake in plain English (ADR 0038 moves them to a
  message table).

## Alternatives Considered

- **Let a resolver throw and catch it per record.** Rejected: the reason would be
  lost, and a failure of the service would be caught with it.
- **Report a left-out record through `source_exclusions`.** Rejected for this use:
  it records a person's decision to exclude a record, it holds no URL or evidence,
  and it requires one licensing authority per source namespace, which a national
  source does not have.
