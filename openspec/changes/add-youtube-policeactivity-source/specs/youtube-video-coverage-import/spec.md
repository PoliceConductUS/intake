## ADDED Requirements

### Requirement: Acquire searches the channel per agency and stamps results

The `sources/youtube.policeactivity/acquire.ts` phase MUST resolve the
`@PoliceActivity` handle to its immutable YouTube channel id, page agencies via
the acquire `agencies(...)` facade, and for each agency search **within that
channel** by the agency's name and place. Each matched video MUST be stored with
its `videoId`, `title`, `description`, `publishedAt`, `channelId`, canonical
`url`, and retrieval time, **stamped with the agency's namespace-local source id**.

#### Scenario: a per-agency channel search yields agency-stamped video evidence

- **WHEN** acquire searches the channel for a given agency and gets a video hit
- **THEN** the video is stored with its videoId, title, description, publishedAt, channelId, url, and the agency source id it was found for

#### Scenario: an unavailable or changed video is a visible source-state result

- **WHEN** a previously seen video is deleted, private, or its content changed
- **THEN** acquire writes an explicit source-state record for it rather than dropping it silently

#### Scenario: re-running an unchanged channel is idempotent

- **WHEN** acquire runs again on an unchanged channel/agency state
- **THEN** no duplicate video evidence is produced (evidence is keyed by agency source id and videoId)

### Requirement: Captions are never fetched or read

Acquire MUST require `YOUTUBE_API_KEY`, all network access lives in acquire,
and acquire MUST request only the keyed Data API on `www.googleapis.com`. It MUST
NOT fetch caption/transcript text: the timedtext track is served from a
`www.youtube.com` path that host's robots.txt disallows (`Disallow: /api/`), and
we do not request paths a publisher disallows. Run MUST draw officer mentions
and their passages from the video's title and description only, never from
caption text.

#### Scenario: captions are never fetched

- **WHEN** acquire runs any phase of the channel search
- **THEN** every request goes to `https://www.googleapis.com/youtube/v3`, no request is sent to `www.youtube.com/api/timedtext`, and no stored video holds caption text

#### Scenario: caption text a video file still holds links no officer

- **WHEN** a video file holds a `captions` field naming an officer that the video's title and description do not name
- **THEN** no officer is resolved from that field and no CoverageLinkAgencyPersonnel is emitted for it

### Requirement: Run resolves officers at the acquired agency and never guesses

The `run.ts` phase MUST be deterministic and MUST link a video only to
**existing** personnel at the agency the acquire stamped — it MUST NOT mint an
agency or personnel record, MUST NOT resolve an agency from free text, and MUST
NOT infer an officer from appearance, geography, title fragments, or comments.
Every emitted link MUST carry the source passage supporting it. (Linking a video
to an existing civil case is a planned extension, gated on a match-only `resolveCivilCase` capability.)

#### Scenario: a video naming a resolvable officer at its acquired agency emits a cited link

- **WHEN** a video acquired for an agency names an officer that resolves to one existing officer at that agency
- **THEN** a CoverageLink is emitted for the video and a CoverageLinkAgencyPersonnel links it to that officer, with the supporting passage recorded in the link notes

#### Scenario: an unresolvable or ambiguous mention produces no link

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency, or to more than one candidate
- **THEN** no CoverageLinkAgencyPersonnel is emitted for that mention and no personnel record is created

#### Scenario: a video with no verified link emits no durable coverage record

- **WHEN** a video resolves to no existing officer or case
- **THEN** no CoverageLink is emitted for it (a visible unmatched result, not silent success)

#### Scenario: run is deterministic

- **WHEN** `run()` executes twice on the same acquired evidence
- **THEN** the two returned manifests and emitted records are deep-equal
