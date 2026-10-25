## ADDED Requirements

### Requirement: A channel source is pinned to an immutable channel id

A YouTube channel source MUST pin the channel's immutable id and the provenance of
that id in its configuration. Acquire MUST resolve the configured handle through
the Data API on every run and MUST abort the run when the handle no longer
resolves to the pinned id, rather than ingesting videos from the channel the
handle now points at. The resolved id, its provenance, and the resolution time
MUST be preserved with the acquisition. Transform MUST reject an envelope that was
acquired from any channel other than the pinned one.

#### Scenario: the handle still resolves to the pinned channel

- **WHEN** acquire resolves the configured handle and gets the pinned channel id
- **THEN** the run proceeds and stores the channel id, its provenance, and the resolution time with the acquisition

#### Scenario: the handle was renamed or transferred

- **WHEN** acquire resolves the configured handle and gets a different channel id
- **THEN** the run fails with both ids named and no video is ingested

#### Scenario: an envelope from another channel is refused

- **WHEN** transform reads an envelope stamped with a channel id other than the pinned one
- **THEN** it fails rather than emitting links from it

### Requirement: Only videos inside the rolling five-year window produce links

Each acquire run MUST compute the five-year window ending at that run, MUST record
it with the acquisition and in every per-agency envelope it writes — including
envelopes for agencies it did not search this run — and transform MUST emit no
coverage link for a video published outside the window recorded in its envelope.
Transform MUST NOT read the clock, so that re-running it on one acquisition
reproduces the same links. Transform MUST fail on an envelope that records no
window rather than treating it as unbounded.

#### Scenario: an in-window video with a resolved officer produces a link

- **WHEN** a video published inside the envelope's window names an officer that resolves at the acquired agency
- **THEN** a CoverageLink and a CoverageLinkAgencyPersonnel are emitted for it

#### Scenario: a video published before the window opened produces no link

- **WHEN** a cached video published before the envelope's window start names an officer that resolves at the acquired agency
- **THEN** no CoverageLink and no CoverageLinkAgencyPersonnel are emitted for it

#### Scenario: an envelope with no recorded window is refused

- **WHEN** transform reads an envelope that records no acquire window
- **THEN** it fails and asks for acquire to be re-run

#### Scenario: the window rolls forward without re-acquiring older years

- **WHEN** acquire runs again and the window's floor year has advanced
- **THEN** cached year buckets before the new floor year are pruned and the clamped oldest search is not redone

### Requirement: Links only, and only to records that already exist

A channel source MUST store no video media — only the video's metadata and a link
to its canonical URL. It MUST link a video only to **existing** personnel at the
agency the acquire stamped, and MUST NOT create an agency or a personnel record
from a video. A mention resolving to no existing officer, or ambiguously, MUST
produce no link. The source-local identity of a video MUST be its stable YouTube
video id, and the canonical URL, channel id, publication time, retrieval time and
the passage supporting each officer link MUST be preserved.

#### Scenario: an unmatched or ambiguous mention produces no link and mints nothing

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency, or to more than one candidate
- **THEN** no CoverageLinkAgencyPersonnel is emitted for that mention, no CoverageLink is emitted for a video with no resolved officer, and no agency or personnel record is created

#### Scenario: an emitted link preserves the video's provenance

- **WHEN** a CoverageLink is emitted for a video
- **THEN** it carries the canonical watch URL, the channel id, the full publication time, the retrieval time, and the video id, with the publisher's own framing kept separate as an attributed claim

### Requirement: A skipped in-window video is reconsidered on every later run

A video that produced no link MUST NOT have that outcome recorded as a durable
decision. While it remains inside the rolling window, every later run MUST
re-evaluate it against current database state, so the link appears once the
matching officer and agency exist without any backfill step. Re-running on
unchanged source and database state MUST NOT duplicate links.

#### Scenario: the officer appears after the video was skipped

- **WHEN** a run skips an in-window video because its named officer is not in the database, and a later run re-reads the same video after that officer and agency exist
- **THEN** the later run emits the CoverageLink and the officer link

#### Scenario: re-running unchanged state is idempotent

- **WHEN** transform runs twice on the same envelopes with the same database state
- **THEN** the two manifests are deep-equal and no duplicate link is produced (records are keyed by the stable video id)

### Requirement: Video URL canonicalization preserves video-id case

Canonicalization MUST preserve the case of the YouTube video id in the value
stored in `coverage_links.normalized_url`, which carries a unique index. Only the
scheme and host may be case-folded, because video ids are case-sensitive and
collapsing two distinct ids onto one normalized URL would let one video block the
other or attach officer links to the wrong video.

#### Scenario: two ids differing only in case stay distinct

- **WHEN** two watch URLs whose video ids differ only in letter case are canonicalized
- **THEN** their normalized URLs differ
