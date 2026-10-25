## ADDED Requirements

### Requirement: Donut Operator acquire pins the channel by immutable id

The `sources/youtube.donutoperator/acquire.ts` phase MUST resolve the
`@DonutOperator` handle and MUST refuse to proceed unless it resolves to the
pinned channel id `UCwkm_Wcyh0pc7UUmZZfL-6w`. It MUST search **within that
channel** per agency, paging agencies via the acquire `agencies(...)` facade, and
MUST store each hit with its `videoId`, `title`, `description`, `publishedAt`,
`channelId`, canonical `url`, retrieval time, and available caption text (or an
explicit no-captions marker), stamped with the agency's namespace-local source id.
It MUST require `YOUTUBE_API_KEY`. No video media is downloaded or stored — links
and metadata only. All network access lives in acquire.

#### Scenario: the handle no longer resolves to the pinned channel

- **WHEN** acquire resolves `@DonutOperator` and gets any id other than the pinned one, or no channel
- **THEN** the run fails with an error naming both ids, and no video is acquired

#### Scenario: a hit claiming a different channel never enters the archive

- **WHEN** a search result's `channelId` is not the pinned channel id
- **THEN** the video is dropped with a log line rather than stored

#### Scenario: re-running an unchanged channel is idempotent

- **WHEN** acquire runs again on unchanged channel and agency state
- **THEN** no duplicate video evidence is produced (evidence is keyed by agency source id and videoId)

### Requirement: Eligibility is bounded by a rolling five-year window

Each run MUST consider only videos published within the five-year period ending at
that run. The window length MUST be fixed in code rather than configured, and
`YOUTUBE_MIN_YEAR` MUST NOT widen or narrow it. The window MUST be re-applied when
records are emitted, not only when videos are acquired, so that a video which has
aged out stops producing a link even though it remains in the acquired archive. A
publication time that is missing, malformed, or not an unambiguous instant MUST be
treated as outside the window.

#### Scenario: an in-window video is eligible

- **WHEN** a video's publication instant is at or after five years before the run and at or before the run
- **THEN** it is eligible for linking (subject to the officer requirement)

#### Scenario: a video that has aged out stops producing a link

- **WHEN** a previously linked video's publication instant falls more than five years before the current run
- **THEN** the run emits no link for it, without any configuration change

#### Scenario: a future-dated or undatable video is not eligible

- **WHEN** a video is dated after the run, or its publication time is absent or not a parseable instant
- **THEN** no link is emitted for it and no officer is resolved for it

#### Scenario: backfill is not starved by refreshing recent years

- **WHEN** some agencies have never been searched and others have already been searched for the current year
- **THEN** acquire searches every never-searched agency-year in the window before it re-searches any already-searched year

### Requirement: A link requires an existing officer at the acquired agency

`transform.ts` MUST be deterministic and MUST emit a `CoverageLink` only for a
video that resolves to at least one **existing** officer at the agency the acquire
stamped. It MUST NOT create an agency or personnel record, MUST NOT resolve an
agency from free text, and MUST NOT infer an officer from appearance, geography,
title fragments, or comments. Every emitted officer link MUST carry the source
passage supporting it. A candidate name resolving to no record, or ambiguously,
MUST yield no link.

#### Scenario: an in-window video naming a resolvable officer emits a cited link

- **WHEN** an in-window video acquired for an agency names an officer that resolves to one existing officer at that agency
- **THEN** a CoverageLink is emitted for the video and a CoverageLinkAgencyPersonnel links it to that officer, with the supporting passage in the link notes

#### Scenario: an unresolvable or ambiguous mention produces no link

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency, or to more than one candidate
- **THEN** no CoverageLinkAgencyPersonnel is emitted for that mention and no personnel record is created

#### Scenario: a video with no resolved officer emits no durable coverage record

- **WHEN** an in-window video resolves to no existing officer
- **THEN** no CoverageLink is emitted for it either, and the exclusion is counted in the run's summary

#### Scenario: the agency on a link always already exists

- **WHEN** any link is emitted
- **THEN** its agency is the one acquire took from the agencies facade, never an agency parsed from video text

#### Scenario: transform is deterministic

- **WHEN** `transform()` executes twice on the same acquired evidence, database state, and window
- **THEN** the two returned manifests and emitted records are deep-equal

### Requirement: A skipped video is reconsidered on later runs

A video skipped because its officer could not be resolved MUST be skipped for that
run only. It MUST remain in the acquired archive and be re-resolved on every later
run for as long as it stays inside the rolling window, so it is linked
automatically once the matching officer and agency are present, with no manual
replay and no backlog to maintain.

#### Scenario: a previously skipped video is linked after the officer appears

- **WHEN** a run re-reads an unchanged archive after an officer named by a previously skipped in-window video has been added to that video's agency
- **THEN** that run emits the CoverageLink and the officer link for it

#### Scenario: re-running unchanged source and database state does not duplicate links

- **WHEN** a run repeats with unchanged acquired evidence and unchanged database state
- **THEN** it emits the identical record keys (the YouTube video id, and video id with officer id), so the import upserts rather than inserting duplicates
