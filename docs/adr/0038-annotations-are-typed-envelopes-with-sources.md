# ADR 0038: Annotations Are Typed Envelopes with Sources

## Status

Proposed

> Proposed with the OpenSpec change `type-annotation-envelopes`. Not implemented.
> The CourtListener complaint annotations of `move-complaint-summaries-to-generate`
> use the current flat shape and move to this one when it is accepted.

## Context

An annotation today is one flat shape: a `type` of warning, error or correction, a
field, a value, a plain-text message and a free-form evidence list. Three things do
not fit it.

- **Evidence has no form.** An annotation cannot say where its evidence came from in
  a way a reader can follow or intake can audit. Each producer invents the records it
  puts in the evidence list.
- **policeconduct.org cannot render it well without knowing what it means.** The site
  prints the message and dumps the evidence as JSON. The site is meant to be unaware
  of intake's data model and meanings, so it cannot interpret a reason code to do
  better.
- **Markup in the message is unsafe.** Messages quote source text. Treating a message
  as HTML or Markdown would make every producer responsible for escaping that text on
  a public page about a real officer.

## Decision

**An annotation is a typed intake envelope that carries its sources, and
policeconduct.org chooses how to render it by its kind.**

**1. A kind per sort of annotation.** Each sort of annotation is an envelope with
`apiVersion: policeconduct.org/intake/v1alpha1`, its own `kind`, `metadata` and a
strict `spec`, read and written through that kind's canonical IO (ADR 0001, ADR 0009).

**2. Sources, of two sorts.**

- A **public source** is something a reader can open: what it is, its full `http` or
  `https` URL, and the retrieval time and SHA-256 when intake retrieved it.
- An **intake reference** pinpoints retained material: `commandId`, `namespace`,
  `kind`, `sourceId`, and a `location` holding a `base` of `command-folder` or
  `state-folder`, a path relative to that base, a media type and a SHA-256. A source
  that keeps its documents in state and not in the command folder (CourtListener
  complaints) uses `state-folder`.

**3. The intake reference stays in intake.** It is for audit (ADR 0013). It is not
shown in the policeconduct.org UI.

**4. The message is plain English, kept in one place.** Intake writes the
reader-facing wording. It says what the problem is in words a typical site visitor
knows and would use correctly: no buzzwords and no intake or court-system terms left
unexplained. The annotation row holds a message code, a foreign key to a table of
messages that intake owns, so wording is changed in one place and can later gain
links or other parts. Anything a reader should be able to open is a public source,
never markup in the message.

**5. The row names its kind, and the site looks up a component.** The annotation row
in the database holds the annotation's kind. During static generation
policeconduct.org looks up a component for that kind and uses it when one exists.
When none exists a default renderer shows parts of the record as preformatted JSON,
and the build does not fail. A new kind from intake therefore appears on the site
without a site change.

**6. One shape.** Existing annotations are rewritten in the new shape with their IDs
kept (ADR 0008). The flat shape is not kept alongside it.

**7. `type` and `kind` are distinct.** `type` stays as it is: warning, error,
correction, or whatever is added later. It says how the finding is treated. `kind`
says what sort of annotation it is and selects the envelope and the component.

## Consequences

- The annotation table needs a migration for the typed payload, and existing rows are
  rewritten once, so this needs a production migration plan.
- Every producer of an annotation moves to the new shape in the same change.
- Intake publishes the annotation kinds' schemas with its import schemas, and
  policeconduct.org builds its components against them.
- policeconduct.org needs a one-time change: the lookup by kind and the default
  renderer.
