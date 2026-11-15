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

### Requirement: Legacy Salesforce document links use the current download hostname

MN POST acquisition SHALL request legacy `https://mnitservices--c.documentforce.com/sfc/dist/version/download/` links through `mnitservices.file.force.com`, preserving the exact path, query and file-version identifiers. Raw officer action URLs and saved document URL provenance SHALL remain unchanged. Acquisition SHALL make a single mapped request, without an alternate-host retry chain. A genuine 404 from the mapped endpoint SHALL remain an explicit unavailable-document outcome.

#### Scenario: Legacy content host no longer serves a file

- **WHEN** an officer action references a legacy direct download URL
- **THEN** acquisition requests the current content hostname with the same path/query and preserves the original action URL in its saved evidence

#### Scenario: Current content endpoint reports absence

- **WHEN** the mapped download endpoint returns 404
- **THEN** acquisition records the document as unavailable without requesting another hostname

### Requirement: Null document narratives have explicit field-level absence reasons

Every completed MN POST analysis, whether produced by the automated analyzer or a Codex document review, SHALL supply a nonblank absence reason for each null narrative field. The absence-reason map SHALL contain exactly the null narrative fields; populated narratives SHALL be nonblank and have no absence-reason entry. Reasons SHALL remain separate from the five public narrative values and SHALL NOT change database shape. The document-evidence reader SHALL enforce this contract for every model. Previous analysis contracts and prompt versions SHALL NOT be silently reused as completed current evidence.

Analysis instructions SHALL treat an expressly stated conviction (including an unnamed felony conviction), nonreporting, fee, continuing-education or tax basis as a stated allegation/factual basis even when the underlying incident is not described. Findings SHALL preserve their stated attribution; analysis SHALL NOT invent underlying conduct. An absence reason records the reviewer's asserted explanation and does not independently prove semantic completeness or accuracy.

#### Scenario: An analysis leaves a narrative null

- **WHEN** a narrative is null without a nonblank reason for that field
- **THEN** acquisition/evidence validation rejects the analysis regardless of model

#### Scenario: A populated field includes an absence reason

- **WHEN** a populated narrative also has an absence-reason entry
- **THEN** validation rejects the conflicting analysis contract

#### Scenario: Previously completed evidence uses the old contract

- **WHEN** acquisition encounters a completed document or cached analysis from the previous contract
- **THEN** it fails visibly or reprocesses through the current analysis contract rather than silently reusing the result
