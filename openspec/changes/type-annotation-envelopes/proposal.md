## Why

An annotation today is one flat shape: a type, a field, a value, a plain-text message and a free-form evidence list. It cannot say where its evidence came from in a form a reader can follow or intake can audit, and policeconduct.org can only print the message and dump the evidence as JSON. Putting HTML or Markdown in the message would make every producer responsible for escaping source text on a public page.

## What Changes

- **An annotation is a typed envelope.** Each kind of annotation has its own envelope kind with the standard `apiVersion`, `kind`, `metadata` and a strict `spec`, read and written through canonical IO like every other intake envelope.
- **An annotation carries sources.** A source is one of two things. A public source names something a reader can open: what it is, its full URL, and the retrieval time and hash when intake retrieved it. An intake reference pinpoints the retained material: `commandId`, `namespace`, `kind`, `sourceId`, and a `location` with a `base` of `command-folder` or `state-folder`, a path relative to that base, a media type, and a hash. It stays in intake and is not shown on the website.
- **The message is plain English, kept in one place.** Intake writes the wording in words a typical site visitor knows and would use correctly, with no buzzwords. The annotation row holds a message code, a foreign key to a table of messages that intake owns, so wording is changed in one place. Anything a reader should be able to open is a source, never markup in the message.
- **`type` and `kind` are distinct.** `type` stays as it is: warning, error, correction, or whatever is added later. `kind` says what sort of annotation it is and selects the envelope and the component.
- **policeconduct.org renders by kind.** The annotation row in the database holds its kind, and intake publishes each kind's schema. During static generation the website looks up a component for that kind and uses it when one exists. When none exists a default renderer shows parts of the record as preformatted JSON. The website never interprets a reason code or a field name.
- **Existing annotations move to the new shape.** There is one shape; the flat shape is not kept alongside it.

## Capabilities

### New Capabilities

- `annotation-envelopes`: The envelope kinds, sources and published schema for annotations.

## Impact

Affected: the annotation table (a Supabase migration for the typed payload, the kind and the message code) and a new table of annotation messages, the generated envelope types and import schemas, the shared import that derives annotations, every source that produces one, and the policeconduct.org annotation components. Existing annotation rows are rewritten in the new shape with their IDs kept, so this needs a production migration plan and a generated type refresh. No data reset.

The design is recorded in ADR 0038, proposed with this change. The intake reference is for audit and is not shown in the policeconduct.org UI.
