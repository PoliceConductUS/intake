## ADDED Requirements

### Requirement: A channel coverage source is configuration, not an implementation

A YouTube channel coverage source MUST be defined by a `ChannelSourceConfig`
naming the channel handle, the `source_name` stamped on emitted links, and the
rolling publication window length in years. The acquire and transform behavior
MUST live in one shared implementation (`sources/lib/youtube-channel.ts`), and
each `sources/<namespace>/` MUST contain only that configuration. Adding a
channel MUST NOT require new acquire or transform logic, and the shared
implementation MUST NOT branch on a namespace, handle, or source name.

#### Scenario: a channel source is added by configuration alone

- **WHEN** a new channel is queued for intake
- **THEN** a `sources/<namespace>/` directory containing an `acquire.ts` and a `transform.ts` that supply a `ChannelSourceConfig` to the shared factories is sufficient, with no change to the shared implementation, the source registry, the schema, or the artifact envelopes

#### Scenario: LegalEagle is configured as rank 6

- **WHEN** the `youtube.legaleagle` source is described
- **THEN** its configuration is handle `@LegalEagle`, source name `LegalEagle`, and a five-year rolling window

### Requirement: Acquire resolves the channel by handle to its immutable id

Acquire MUST resolve the configured handle to the channel's immutable YouTube
channel id through the YouTube Data API before any search, MUST write that id to
`channel.json` in the source directory, and MUST fail loudly when the handle
does not resolve. It MUST require `YOUTUBE_API_KEY`. The channel id MUST NOT be
checked into the source configuration. Every stored video MUST carry the
`channelId` the API returned for it. All network access MUST live in acquire.

#### Scenario: the handle resolves and is preserved

- **WHEN** acquire runs for a configured handle
- **THEN** the resolved channel id is written to `channel.json` with the handle that produced it, and every subsequent search is scoped to that channel id

#### Scenario: an unresolvable handle fails the run

- **WHEN** the configured handle resolves to no channel
- **THEN** acquire throws, naming the namespace and the handle, and writes no envelopes

#### Scenario: a missing API key fails the run

- **WHEN** `YOUTUBE_API_KEY` is absent or blank
- **THEN** acquire throws before any network call

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
- **THEN** it stores the video's id, canonical url, title, description, publication time, channel id, retrieval time, and available caption text, and never the video media itself

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
