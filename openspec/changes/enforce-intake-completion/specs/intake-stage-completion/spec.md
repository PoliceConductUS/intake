## ADDED Requirements

### Requirement: Local inputs do not bypass acquisition

For a source with an acquisition module, intake SHALL run that module on locally staged inputs before promoting them as completed acquisition. Failure SHALL preserve resumable work and SHALL NOT promote incomplete input. Sources without an acquisition module SHALL continue to support local input acquisition.

#### Scenario: Locally seeded analysis fails

- **WHEN** source files are supplied with `--from-local` and required analysis fails
- **THEN** acquisition fails, preserves resumable files, and does not publish the incomplete snapshot as successful

#### Scenario: Completed cached input

- **WHEN** all required acquisition work is already cached
- **THEN** acquisition reuses that work and completes without unnecessary repeated analysis

### Requirement: Successful phase outputs are required

Generation and internal artifact import SHALL require a recorded successful transformation whose input snapshot and output integrity still match. They SHALL reject missing completion evidence, changed input, changed artifacts, and a failed newer transformation rather than silently selecting older output. The current generation SHALL consume only its own mutation output. Explicit standalone/manual sources SHALL retain their existing no-network-acquisition semantics.

#### Scenario: Helper-created or stale artifacts

- **WHEN** generation is given unrecorded artifacts or artifacts whose source inputs or output bytes changed
- **THEN** it fails before appending or applying database mutations

#### Scenario: Transform fails after a previous success

- **WHEN** a newer transform attempt fails
- **THEN** generation fails instead of selecting an older successful transform

### Requirement: Referenced disciplinary documents have an explicit processing outcome

MN POST transformation SHALL reject every referenced document without completed, structurally valid analysis or a matching documented unavailable-source outcome. Saved evidence SHALL match the analyzed document. Unfinished downloaded documents SHALL NOT be excused by a missing analysis or stale skip record. Completed analysis MAY contain null narrative fields when the document supplies no value. Existing narrative values SHALL remain unchanged when an explicitly unavailable document supplies no replacement.

#### Scenario: Personnel collection skips document analysis

- **WHEN** personnel detail files reference a document that has no completed analysis and no matching unavailable-source outcome
- **THEN** transform fails before writing importable Artifacts and identifies the missing document

#### Scenario: Source document is unavailable

- **WHEN** acquisition records a matching unavailable-document outcome and no conflicting unfinished document exists
- **THEN** transform preserves the explicit absence of new narrative evidence without clearing stored narratives

### Requirement: Data correction preserves identity and provenance

Regeneration SHALL preserve canonical personnel and discipline identities, keep the 34 user-designated unresolved licenses unresolved, preserve raw evidence, and apply only reviewed forward mutations through intake. No website code change or database reset SHALL be required.

#### Scenario: Missing analysis is recovered

- **WHEN** a linked order is retrieved and analyzed
- **THEN** regenerated discipline fields trace to that order and update the existing canonical record
