## ADDED Requirements

### Requirement: A YouTube channel source is identified by its channel ID

A YouTube source namespace MUST pin the channel's YouTube channel ID and MUST
resolve the channel by that ID alone. The handle and display name MUST be
recorded as provenance and MUST NOT be used to select, search for, or confirm
which channel is ingested. `acquire` MUST fail when `channels.list` for the
pinned ID does not return exactly that channel. `run` MUST fail when the
acquired channel record is not exactly the pinned channel, so the guarantee also
holds when an archived snapshot is replayed without `acquire`.

#### Scenario: the pinned channel is the Donut Operator channel ID

- **WHEN** the `com.youtube.donutoperator` source resolves its channel
- **THEN** it resolves to channel ID `UCwkm_Wcyh0pc7UUmZZfL-6w`

#### Scenario: a snapshot for a different channel is rejected

- **WHEN** `run` reads a `channel.json` whose single item's `id` is not the
  pinned channel ID
- **THEN** `run` throws naming the pinned channel ID, and emits no records

#### Scenario: a foreign upload in the snapshot is rejected

- **WHEN** an uploads page contains an item whose `snippet.channelId` is not the
  pinned channel ID
- **THEN** `run` throws naming the unexpected channel ID, and emits no records

#### Scenario: a renamed handle is evidence, not a failure

- **WHEN** `acquire` observes a `snippet.customUrl` that differs from the pinned
  handle
- **THEN** the drift is logged and written to the snapshot's provenance record
- **AND** the acquire completes against the pinned channel ID

### Requirement: Channel provenance is preserved with every acquire

Each `acquire` MUST write a provenance record alongside the preserved raw
responses capturing the pinned channel ID, handle, canonical channel URL, and
display name; the handle and title observed at retrieval; the uploads playlist
ID; the subscriber count observed at retrieval; the board-provided
subscriber-count snapshot and queue rank; the access method; and the retrieval
timestamp. Raw API responses MUST be preserved unchanged.

#### Scenario: the board's rank-1 snapshot is preserved

- **WHEN** the `com.youtube.donutoperator` source records its queue position
- **THEN** it carries rank `1` with subscriber count `5310000` retrieved on
  `2026-08-24`

#### Scenario: an acquire records its retrieval

- **WHEN** `acquire` completes
- **THEN** the snapshot contains the unmodified `channels.list` response, every
  unmodified `playlistItems.list` page, and a provenance record naming the
  channel ID, the observed subscriber count, the access method, and the
  retrieval timestamp

### Requirement: One CoverageLink per public upload, keyed by video ID

`run` MUST emit exactly one `CoverageLink` record per public upload in the
snapshot, keyed by the YouTube video ID. `url` and `normalized_url` MUST both be
the canonical watch URL built from that video ID, `title` the video title,
`source_name` the channel's pinned display name, and `published_at` the video's
publish time (`contentDetails.videoPublishedAt` — when the video was published,
not when it was added to the uploads playlist).

#### Scenario: a public upload becomes a CoverageLink

- **WHEN** the snapshot contains a public upload with video ID `dQw4w9WgXcQ`,
  title `Officer body camera released`, and `videoPublishedAt`
  `2026-01-15T18:30:00Z`
- **THEN** a `CoverageLink` record keyed `dQw4w9WgXcQ` is emitted with `url` and
  `normalized_url` both `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, `title`
  `Officer body camera released`, `source_name` `Donut Operator`, and
  `published_at` `2026-01-15T18:30:00Z`

#### Scenario: private and deleted uploads are skipped with a count

- **WHEN** an uploads page contains items whose `status.privacyStatus` is not
  `public`, or that are missing a video ID, title, or publish date
- **THEN** no record is emitted for them
- **AND** the run logs how many were skipped for each reason

#### Scenario: run is deterministic

- **WHEN** `run` executes twice over the same snapshot
- **THEN** the two returned manifests are deep-equal

#### Scenario: the artifacts are accepted by root intake

- **WHEN** the emitted manifest is built into an `Artifacts` envelope and read
  back through `Artifacts.read` with `includeKinds: ["CoverageLinks"]`
- **THEN** the read succeeds and every record validates against `CoverageLinkSpec`

### Requirement: A media source emits no personnel associations

A YouTube channel source MUST declare `produces: ["CoverageLinks"]` and MUST NOT
emit `CoverageLinkAgencyOfficers` or any other kind that attaches coverage to a
named person. Commentary about an incident is not a record of an officer's
conduct, and this source carries no stable officer identifier, so any link from
one of its videos to a named officer would rest on matching a person out of free
text. Attaching this coverage to personnel requires a separate reviewed
mechanism and is out of scope for the source.

#### Scenario: the declared produced kinds are coverage only

- **WHEN** the source module's `produces` export is read
- **THEN** it is exactly `["CoverageLinks"]`

#### Scenario: an officer association would fail the run

- **WHEN** the source emits a `CoverageLinkAgencyOfficers` artifact
- **THEN** the run command aborts reporting the undeclared kind, and nothing is
  imported

### Requirement: Acquisition uses YouTube's sanctioned API within its quota

`acquire` MUST read the YouTube Data API v3 and MUST NOT scrape youtube.com. It
MUST require an API key and fail loudly when it is absent. It MAY retry
throttling (429) and transient server errors (5xx) with capped backoff, and MUST
NOT retry a 403 — the status YouTube returns for an exhausted quota or an
invalid key — because retrying it evades a limit rather than respecting it.

#### Scenario: a missing API key fails before any request

- **WHEN** `acquire` runs without `YOUTUBE_API_KEY` set
- **THEN** it throws naming `YOUTUBE_API_KEY`, and issues no HTTP request

#### Scenario: quota exhaustion stops the acquire

- **WHEN** the API responds `403`
- **THEN** `acquire` fails immediately without retrying
