## ADDED Requirements

### Requirement: A channel coverage source is configuration, not an implementation

A YouTube channel coverage source MUST be defined by a `ChannelSourceConfig`
naming the pinned channel id, the handle recorded as provenance, the
`source_name` stamped on emitted links, and the rolling publication window
length in years. The acquire and transform behavior
MUST live in one shared implementation (`sources/lib/youtube-channel.ts`), and
each `sources/<namespace>/` MUST contain only that configuration. Adding a
channel MUST NOT require new acquire or transform logic, and the shared
implementation MUST NOT branch on a namespace, handle, or source name.

#### Scenario: a channel source is added by configuration alone

- **WHEN** a new channel is queued for intake
- **THEN** a `sources/<namespace>/` directory containing an `acquire.ts` and a `transform.ts` that supply a `ChannelSourceConfig` to the shared factories is sufficient, with no change to the shared implementation, the source registry, the schema, or the artifact envelopes

#### Scenario: LegalEagle is configured as rank 6

- **WHEN** the `youtube.legaleagle` source is described
- **THEN** its configuration is channel id `UCpa-Zb0ZcQjTCPP1Dx_1M8Q`, handle `@LegalEagle`, source name `LegalEagle`, and a five-year rolling window

### Requirement: The channel id is pinned and verified, never resolved from a handle

The source configuration MUST pin the channel's immutable YouTube channel id, and
that id MUST be the source's identity. Acquire MUST verify the pinned id through
the YouTube Data API's `channels.list` before any search, MUST scope every search
to it, and MUST fail loudly when the id returns no channel. Acquire MUST NOT
select a channel by handle: a handle can be renamed or transferred to a different
channel, which would silently re-point the source at another channel's videos.
The handle MAY be recorded as provenance, and drift between the configured handle
and the one the API reports MUST be logged rather than acted on. Acquire MUST
write the pinned id, the configured handle, and the live handle and title to
`channel.json`. It MUST require `YOUTUBE_API_KEY`. Every stored video MUST carry
the `channelId` the API returned for it. All network access MUST live in acquire.

#### Scenario: the pinned id is verified and preserved

- **WHEN** acquire runs
- **THEN** it looks the channel up by id, never by handle, and writes the pinned id with the live handle and title to `channel.json`, and every subsequent search is scoped to that id

#### Scenario: an unverifiable pinned id fails the run

- **WHEN** the pinned channel id returns no channel
- **THEN** acquire throws rather than running against an unverified channel, and writes no envelopes

#### Scenario: handle drift does not change channel selection

- **WHEN** the API reports a different handle than the configuration records
- **THEN** acquire logs the drift and still selects by the pinned id

#### Scenario: a missing API key fails the run

- **WHEN** `YOUTUBE_API_KEY` is absent or blank
- **THEN** acquire throws before any network call

### Requirement: Officer candidates come from title and description only

A channel coverage source MUST derive officer-name candidates from the video's
title and description only. It MUST NOT fetch video captions or transcripts:
`youtube.com/robots.txt` carries `Disallow: /api/`, and the only third-party
transcript endpoint, `youtube.com/api/timedtext`, is inside that prefix. The Data
API's `captions.download` requires OAuth as the channel owner, so no sanctioned
third-party transcript path exists. The acquired video record MUST NOT carry a
caption field. Every request a channel source makes MUST go to the keyed Data API
host. The resulting loss of recall is accepted.

#### Scenario: no request reaches a disallowed path

- **WHEN** acquire searches a channel and stores the hits
- **THEN** no request it makes is under `youtube.com/api/`, and every request it makes goes to `www.googleapis.com`

#### Scenario: a name only a transcript would carry produces no link

- **WHEN** an officer is named only in a video's spoken audio and not in its title or description
- **THEN** no candidate is produced for that officer and no link is emitted

### Requirement: Links are re-verified against the pinned channel at emit

Transform MUST confirm each video's `channelId` matches the configured channel id
before emitting any link for it, so the channel guarantee holds on a replay in
which acquire never ran. A video from another channel MUST produce no link.

#### Scenario: a video from another channel is not attributed to this source

- **WHEN** an envelope contains a video whose `channelId` is not the configured channel id
- **THEN** no CoverageLink and no personnel link is emitted for it

### Requirement: Each run considers only the rolling window ending at that run

Acquire MUST compute one publication window per run, spanning the configured
number of years back from the run instant to the run instant, and MUST clip
every search to that window. It MUST stamp the window and the retrieval time
into every envelope it writes. Transform MUST read the window from the envelope
rather than from the clock, and MUST emit no link for a video whose
`publishedAt` falls outside it. A video that has aged out of the window since it
was acquired MUST stop producing links.

#### Scenario: searches are clipped to the window

- **WHEN** acquire searches an agency-year chunk at the oldest edge of the window
- **THEN** the search's `publishedAfter` is the window start rather than the year boundary, and `publishedBefore` at the newest edge is the run instant

#### Scenario: a cached video that aged out of the window emits nothing

- **WHEN** transform reads an envelope containing a video published before the envelope's window start
- **THEN** no CoverageLink and no CoverageLinkAgencyPersonnel is emitted for that video, even though it is still in the acquired cache

#### Scenario: a video published after the window end emits nothing

- **WHEN** an envelope contains a video published after the window end
- **THEN** no link is emitted for it

#### Scenario: the window travels with the evidence

- **WHEN** transform runs on an envelope acquired by an earlier run
- **THEN** it applies the window recorded in that envelope, so a replay reproduces the run it replays

### Requirement: A link requires an existing officer at an existing agency

Transform MUST link a video only to personnel that already exist at the agency
the acquire stamped on the envelope. The agency MUST come from the acquire
`agencies(...)` facade, so it already exists in the database. Transform MUST NOT
mint an agency or a personnel record, MUST NOT resolve an agency from free text,
and MUST NOT infer an officer from appearance, geography, or title fragments
alone. A name that resolves to no existing officer, or ambiguously to more than
one, MUST produce no link. A video with no resolved officer MUST produce no
CoverageLink at all. Every emitted personnel link MUST carry the passage that
names the officer. Transform MUST require a data context and fail loudly without
one.

#### Scenario: a named, resolvable officer produces a cited link

- **WHEN** an in-window video names an officer that resolves to exactly one existing officer at the envelope's agency
- **THEN** a CoverageLink is emitted keyed by the video id, and a CoverageLinkAgencyPersonnel links it to that officer with the naming passage in its notes

#### Scenario: an absent officer produces no link

- **WHEN** a video names an officer who does not exist at that agency
- **THEN** no link is emitted and no personnel record is created

#### Scenario: an ambiguous officer produces no link

- **WHEN** a name resolves to more than one candidate at that agency
- **THEN** the resolver returns no match and no link is emitted for that name

#### Scenario: a video naming nobody produces no link

- **WHEN** a video names no officer
- **THEN** no CoverageLink is emitted for it

#### Scenario: no video media is stored

- **WHEN** acquire stores a video
- **THEN** it stores the video's id, canonical url, title, description, publication time, channel id, and retrieval time, and never the video media itself

### Requirement: Skipped videos are reconsidered on every later run

Transform MUST re-resolve every in-window video in the acquired cache on every
run, so a video skipped for an absent or ambiguous match is picked up
automatically once the matching officer and agency exist, for as long as it
remains in the rolling window. A skip MUST NOT be recorded as a terminal
decision.

#### Scenario: a previously skipped video links after the officer appears

- **WHEN** a video was skipped because its named officer did not exist, and a later run resolves that officer at the same agency while the video is still in window
- **THEN** that run emits the CoverageLink and the personnel link

#### Scenario: re-running unchanged source and database state does not duplicate links

- **WHEN** transform runs twice on the same acquired evidence and the same database state
- **THEN** the two manifests are deep-equal, each video contributing one CoverageLink keyed by its video id and one personnel link per resolved officer keyed by video id and personnel id

### Requirement: Acquisition is paced and fair across agencies

Acquire MUST search at most one agency-year chunk per agency per run to pace the
YouTube search quota, MUST persist each chunk's result before moving on so an
interrupted run resumes rather than repeats, and MUST halt the run on an
exhausted quota rather than retrying it. It MUST order agencies stalest-first,
so a run that halts on quota resumes with the agencies it did not reach. A
single agency's non-quota search failure MUST be logged and skipped uncached, so
a later run retries it.

#### Scenario: a quota exhaustion halts the run

- **WHEN** a search reports an exhausted daily or per-minute quota
- **THEN** acquire stops searching, logs when the quota resets, and leaves the remaining agencies uncached for the next run

#### Scenario: stalest agencies are searched first

- **WHEN** a run begins and some agencies have never been searched while others were searched earlier
- **THEN** the never-searched agencies are searched first, then the least recently searched

#### Scenario: a backfill completes before refreshing

- **WHEN** an agency has window years it has never searched
- **THEN** the newest unsearched year is searched, and only once every window year is cached does the newest year get re-searched for new uploads
