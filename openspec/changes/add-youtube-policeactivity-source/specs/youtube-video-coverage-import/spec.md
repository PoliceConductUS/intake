## ADDED Requirements

### Requirement: The source resolves and preserves one stable channel identity

The source MUST declare the channel by its official handle and MUST resolve that
handle to the channel's stable YouTube channel id (`channels?part=id&forHandle=`)
before any video search. It MUST persist the resolved id in the source's state and
MUST reuse the persisted id on later runs. A later resolution that disagrees with
the persisted id MUST fail the run loudly rather than ingest under a second
identity. Every search and every stored video MUST carry that channel id.

#### Scenario: the first run resolves and persists the channel id

- **WHEN** acquire runs for a source whose state holds no channel id
- **THEN** it resolves the declared handle to the channel id, persists it, and searches that channel id

#### Scenario: a later run reuses the persisted channel id

- **WHEN** acquire runs again and the handle resolves to the persisted channel id
- **THEN** the run proceeds against that same channel id

#### Scenario: a changed channel id halts the run

- **WHEN** the declared handle resolves to a channel id different from the persisted one
- **THEN** the run fails loudly, naming both ids, and acquires nothing

#### Scenario: an unresolvable handle halts the run

- **WHEN** the declared handle resolves to no channel
- **THEN** the run fails loudly and acquires nothing

### Requirement: Each run considers only the rolling five-year publication window

A run MUST consider only videos published inside the five-year period ending at
that run's clock reading. Acquire MUST compute that window once per run, MUST
bound every channel search to it, MUST store the window with the evidence it
writes, and MUST exclude an out-of-window video from the evidence envelope the
produce phase reads. The produce phase MUST be deterministic: it MUST apply the
window stamped on the evidence rather than read the clock itself. The window
length MUST be declared by the source configuration, not by an environment
variable or a caller-supplied override.

#### Scenario: searches are bounded by the window

- **WHEN** acquire searches the channel for an agency
- **THEN** the search is bounded by `publishedAfter`/`publishedBefore` inside the window ending at the run

#### Scenario: an out-of-window video produces no link

- **WHEN** a cached video's publication time is older than five years before the run
- **THEN** it is absent from the evidence envelope and no coverage link is emitted for it

#### Scenario: the window travels with the evidence

- **WHEN** acquire writes a per-agency evidence envelope
- **THEN** the envelope records the window start and end the run used, and the produce phase filters against that stamped window with no clock access

#### Scenario: evidence missing the window stamp is rejected

- **WHEN** the produce phase reads an evidence envelope without a window stamp, a video publication time, or a video retrieval time
- **THEN** it fails loudly instead of emitting links from incomplete evidence

### Requirement: Acquire searches the channel per agency and stamps results

The acquire phase MUST page agencies via the acquire `agencies(...)` facade and,
for each agency, search **within the declared channel** by the agency's name and
place. Each matched video MUST be stored with its `videoId`, `title`,
`description`, `publishedAt`, `channelId`, canonical `url`, and its retrieval
time, **stamped with the agency's namespace-local source id**. It MUST require
`YOUTUBE_API_KEY`. All network access lives in acquire, and acquire MUST use only
the YouTube Data API — it MUST NOT request a path the channel's `robots.txt`
disallows, and it MUST NOT download or store video media.

#### Scenario: a per-agency channel search yields agency-stamped video evidence

- **WHEN** acquire searches the channel for a given agency and gets a video hit
- **THEN** the video is stored with its videoId, title, description, publishedAt, channelId, url, retrieval time, and the agency source id it was found for

#### Scenario: no media and no disallowed path is fetched

- **WHEN** acquire collects evidence for a video
- **THEN** it stores only the video's metadata and link, fetching no media stream and no `robots.txt`-disallowed path

#### Scenario: re-running an unchanged channel is idempotent

- **WHEN** acquire runs again on an unchanged channel/agency state
- **THEN** no duplicate video evidence is produced (evidence is keyed by agency source id and videoId)

#### Scenario: a changed video updates its evidence

- **WHEN** a re-searched video's title or description differs from the cached observation
- **THEN** the newest observation replaces the cached one, with its retrieval time, so the change reaches the coverage link as an update

#### Scenario: backfill completes, then the window end stays fresh

- **WHEN** every calendar year the window covers has been searched for an agency
- **THEN** the next run re-searches the year the window ends in, so videos published since the last run are picked up

### Requirement: A skipped video is reconsidered on every later run in the window

A video that produced no link MUST stay in the source's evidence and MUST be
reconsidered on every later run while it remains inside the rolling window, so it
becomes a link automatically once the officer and agency it names exist. Acquire
MUST NOT re-search a completed past year to achieve this, and the produce phase
MUST NOT record a durable "rejected" verdict that suppresses the retry.

#### Scenario: an unmatched video is retried after the officer exists

- **WHEN** a video named an officer who did not exist at the acquired agency, and a later import adds that officer and agency
- **THEN** a later produce run over the same evidence emits the coverage link and the officer link, with no re-acquisition

#### Scenario: a video that ages out stops being reconsidered

- **WHEN** a still-unmatched video's publication time leaves the rolling window
- **THEN** later runs no longer consider it and it never produces a link

### Requirement: Produce resolves officers at the acquired agency and never guesses

The produce phase MUST be deterministic and MUST link a video only to **existing**
personnel at the agency the acquire stamped — it MUST NOT mint an agency or
personnel record, MUST NOT resolve an agency from free text, and MUST NOT infer an
officer from appearance, geography, title fragments, or comments. Candidate
officer names come from the video's title and description only. Every emitted link
MUST carry the source passage supporting it.

#### Scenario: a video naming a resolvable officer at its acquired agency emits a cited link

- **WHEN** an in-window video acquired for an agency names an officer that resolves to one existing officer at that agency
- **THEN** a CoverageLink is emitted for the video, keyed by its YouTube video id, and a CoverageLinkAgencyPersonnel links it to that officer with the supporting passage in the link notes

#### Scenario: an unresolvable or ambiguous mention produces no link

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency, or to more than one candidate
- **THEN** no CoverageLinkAgencyPersonnel is emitted for that mention and no personnel record is created

#### Scenario: a video with no verified link emits no durable coverage record

- **WHEN** a video resolves to no existing officer
- **THEN** no CoverageLink is emitted for it (a visible unmatched result, not silent success)

#### Scenario: produce is deterministic

- **WHEN** the produce phase executes twice on the same acquired evidence
- **THEN** the two returned manifests and emitted records are deep-equal
