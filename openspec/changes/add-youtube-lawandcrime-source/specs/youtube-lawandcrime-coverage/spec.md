## ADDED Requirements

### Requirement: The source is pinned to the official Law&Crime channel id

The `youtube.lawandcrime` source MUST identify its channel by the immutable
YouTube channel id `UCz8K1occVvDTYDfFo7N5EZw` and MUST select the channel by that
id, never by handle or display name. Acquire MUST verify the pinned id resolves
to a live channel through `channels.list?id=` and MUST record the resolved handle
and display title as provenance in `channel.json`. Transform MUST re-verify the
archived `channel.json` id and MUST reject any acquired video whose `channelId`
is not the pinned id, so the guarantee holds on a replay where acquire never
runs. A mismatch MUST fail the run loudly rather than import the video.

#### Scenario: acquire verifies the pinned channel id and records the handle as provenance

- **WHEN** acquire starts and `channels.list?id=UCz8K1occVvDTYDfFo7N5EZw` returns that channel
- **THEN** `channel.json` records the pinned id with the resolved handle and display title, and the search proceeds against that id

#### Scenario: a pinned id that resolves to no channel fails the run

- **WHEN** `channels.list` returns no item for the pinned id
- **THEN** acquire fails loudly and writes no video evidence

#### Scenario: a video from another channel is rejected

- **WHEN** an acquired envelope contains a video whose `channelId` is not the pinned id
- **THEN** transform fails loudly rather than emitting a coverage link for it

### Requirement: Each run considers only videos inside the rolling five-year window

Acquire MUST compute a publication window of the five-year period ending at the
run's own clock, MUST bound every channel search to that window, MUST record the
window in each envelope it writes, and MUST write only in-window videos to the
envelope. Transform MUST be deterministic and MUST NOT read the clock: it emits
links for exactly the videos the envelope carries. An agency-year that has aged
out of the window MUST be dropped from the cache and the envelope so it produces
no further links. Ageing out MUST NOT delete an already-imported row; the window
governs which links are created.

#### Scenario: the search is bounded to the rolling window

- **WHEN** acquire searches the channel for an agency
- **THEN** the request is bounded to a year inside the five-year period ending at the run, and no year older than that period is searched

#### Scenario: an out-of-window video produces no link

- **WHEN** an envelope is written for an agency whose cache holds a video published before the window start
- **THEN** that video is absent from the envelope and no coverage link is emitted for it

#### Scenario: transform does not depend on the clock

- **WHEN** transform runs twice on the same envelope at different times
- **THEN** it returns the identical manifest both times

#### Scenario: ageing out is not a delete

- **WHEN** a video that previously imported falls out of the window
- **THEN** the manifest simply omits it and no delete mutation is produced for the existing row

### Requirement: A link requires a definitive match to an existing officer at an existing agency

Transform MUST emit a `CoverageLink` for a video only when the video names at
least one officer that resolves, through the intake-owned `resolvePersonnel`
resolver, to exactly one existing officer at the agency the acquire stamped —
and that agency MUST itself already exist in the database, which it does by
construction because acquire enumerates agencies from the `data.agencies(...)`
facade. The source MUST NOT create or request creation of an agency or a
personnel record, MUST NOT resolve an agency from free text, and MUST NOT infer
an officer from geography, appearance, title fragments, or comments. Every
emitted `CoverageLinkAgencyPersonnel` MUST carry the passage that names the
officer.

#### Scenario: a video naming a resolvable officer emits a cited link

- **WHEN** an in-window video acquired for an agency names an officer that resolves to one existing officer at that agency
- **THEN** a `CoverageLink` keyed by the video id is emitted and a `CoverageLinkAgencyPersonnel` links it to that officer with the naming passage in `notes`

#### Scenario: an absent officer match is skipped for this run

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency
- **THEN** no `CoverageLink` and no `CoverageLinkAgencyPersonnel` is emitted for it and no personnel record is created

#### Scenario: an ambiguous officer match is skipped for this run

- **WHEN** a video's officer mention cannot be separated between two existing officers at the acquired agency
- **THEN** the resolver returns no match, no link is emitted, and neither candidate is attached

#### Scenario: no video media is ingested

- **WHEN** a video qualifies
- **THEN** only its link and textual metadata are stored, and no video or audio media is downloaded or stored

### Requirement: A skipped video is reconsidered on every later in-window run

Skipping a video MUST be a per-run outcome and MUST NOT be recorded as a durable
exclusion. For as long as a video remains inside the rolling window, every run
MUST re-write it into its agency's envelope from cache and transform MUST
re-attempt resolution for it, so it links automatically on the first run after
the matching officer and agency exist, with no re-fetch and no manual backfill.

#### Scenario: a video skipped for a missing officer links on a later run

- **WHEN** a video was skipped because its named officer did not exist, and a later run happens after that officer is imported at the acquired agency
- **THEN** the later run emits the coverage link and the officer link for that same video id

#### Scenario: a video is reconsidered without a second fetch

- **WHEN** a later run reconsiders an already-cached in-window agency-year
- **THEN** no additional channel search is issued for that agency-year and the cached videos are re-resolved

### Requirement: Source-local identity is the stable video id and re-runs do not duplicate

Each `CoverageLink` MUST be keyed by the stable YouTube video id and each
`CoverageLinkAgencyPersonnel` by that video id with the resolved officer, so an
unchanged source and database state MUST produce the identical manifest and no
duplicate links. The envelope MUST preserve, for every video, the stable video
id, the canonical `https://www.youtube.com/watch?v=<id>` URL, the channel id, the
publication time, the retrieval time, the declared window, and the agency source
id it was found for.

#### Scenario: re-running unchanged state does not duplicate links

- **WHEN** acquire and transform run again with the same channel state and the same database state
- **THEN** the manifest is identical, keyed by the same video ids, and the import creates no duplicate link rows

#### Scenario: the envelope preserves link provenance

- **WHEN** acquire writes a video to an agency's envelope
- **THEN** the entry carries its video id, canonical URL, channel id, publication time, and retrieval time, and the envelope carries the channel id, the declared window, and the agency source id

### Requirement: Caption fetching is not used by this source

This source MUST derive officer-name candidates from the video title and
description returned by the YouTube Data API only. It MUST NOT request
`https://www.youtube.com/api/timedtext`, which `https://www.youtube.com/robots.txt`
disallows under `Disallow: /api/`.

#### Scenario: no caption request is issued

- **WHEN** acquire processes a video hit
- **THEN** it issues no request to a path disallowed by the publisher's robots.txt, and the stored evidence contains no caption text
