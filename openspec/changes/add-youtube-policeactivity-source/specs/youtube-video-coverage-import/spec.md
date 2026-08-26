## ADDED Requirements

### Requirement: Acquire fetches channel videos and captions as raw evidence

The `sources/youtube.policeactivity/acquire.ts` phase MUST resolve the
`@PoliceActivity` handle to its immutable YouTube channel id, page the channel's
uploads, and store per video its `videoId`, `title`, `description`,
`publishedAt`, `channelId`, canonical `url`, retrieval time, and available caption
text (or a record that none is available) as raw evidence under `sourceDir`. It
MUST require `YOUTUBE_API_KEY`. All network access lives in acquire.

#### Scenario: a channel page yields per-video evidence

- **WHEN** acquire reads a page of the channel's uploads
- **THEN** each video is stored with its videoId, title, description, publishedAt, channelId, url, and caption text or an explicit no-captions marker

#### Scenario: an unavailable or changed video is a visible source-state result

- **WHEN** a previously seen video is deleted, private, or its content changed
- **THEN** acquire writes an explicit source-state record for it rather than dropping it silently

#### Scenario: re-running an unchanged channel is idempotent

- **WHEN** acquire runs again on an unchanged channel state
- **THEN** no duplicate video evidence is produced (evidence is keyed by videoId)

### Requirement: Run resolves videos to existing records only and never guesses

The `run.ts` phase MUST be deterministic and MUST link a video only to
**existing** agencies, personnel, and civil cases — it MUST NOT mint an agency or
personnel record, and MUST NOT infer an officer or agency from appearance,
geography, title fragments, or comments. Every emitted link MUST carry the source
passage (with caption timestamp when applicable) supporting it.

#### Scenario: a video naming a resolvable officer at a resolved agency emits a cited link

- **WHEN** a video's text names an agency that resolves to an existing agency and an officer that resolves to an existing officer at that agency
- **THEN** a CoverageLink is emitted for the video and a CoverageLinkAgencyPersonnel links it to that officer, with the supporting passage recorded in the link notes

#### Scenario: an unresolvable or ambiguous mention produces no link

- **WHEN** a video's officer or agency mention resolves to no existing record, or to more than one candidate
- **THEN** no CoverageLinkAgencyPersonnel is emitted for that mention and no agency or personnel record is created

#### Scenario: a video with no verified link emits no durable coverage record

- **WHEN** a video resolves to no existing officer, agency, or case
- **THEN** no CoverageLink is emitted for it (a visible unmatched result, not silent success)

#### Scenario: run is deterministic

- **WHEN** `run()` executes twice on the same acquired evidence
- **THEN** the two returned manifests and emitted records are deep-equal

### Requirement: The run data context resolves an agency by name, match-only

`RunDataContext` MUST expose `resolveAgency({ name, state? })` returning a
namespace-local agency source id or `null`. It MUST NOT mint an agency and MUST
NOT return a canonical id. It returns `null` when no existing agency matches with
sufficient confidence.

#### Scenario: a confident name match resolves to an existing agency

- **WHEN** `resolveAgency` is called with a name that matches one existing agency with sufficient confidence
- **THEN** it returns that agency's namespace-local source id

#### Scenario: no confident match returns null

- **WHEN** `resolveAgency` is called with a name that matches no existing agency, or matches ambiguously below the confidence threshold
- **THEN** it returns `null` and no agency is created
