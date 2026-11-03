## ADDED Requirements

### Requirement: Audit the Audit resolves to its stable channel id

The `sources/youtube.audittheaudit` source MUST identify its channel by the
stable YouTube channel id `UCc-0YpRpqgA5lPTpSQ5uo-Q`, searching by that id and
never by handle or display name. Acquire MUST re-resolve the `@AuditTheAudit`
handle through the Data API on every run and MUST fail the run when the handle
resolves to any other id or to no channel. Every acquired and every re-read video
MUST be rejected when its channel id is not the configured one.

#### Scenario: the handle still answers with the configured channel id

- **WHEN** acquire resolves `@AuditTheAudit` and the Data API returns `UCc-0YpRpqgA5lPTpSQ5uo-Q`
- **THEN** the run proceeds and records the handle, channel id, window, and retrieval time as provenance

#### Scenario: a reassigned handle stops the run

- **WHEN** the handle resolves to a different channel id, or to no channel
- **THEN** acquire fails without searching, so the source cannot silently follow the handle to another channel

#### Scenario: a video from another channel is rejected

- **WHEN** acquired evidence holds a video whose channel id is not the configured one
- **THEN** the run fails for that evidence rather than linking the video

### Requirement: Only the rolling five-year period ending at the run qualifies

Each run MUST consider only videos published within the five-year period ending
at that run. The period MUST be computed in the acquire phase, recorded in the
evidence it writes, and applied by the deterministic transform phase from that
record — the transform MUST NOT read wall-clock time. Evidence that records no
period MUST fail the run. A publication time that is not an ISO 8601 instant MUST
NOT qualify.

#### Scenario: an in-window video is considered

- **WHEN** a video was published inside the recorded five-year period
- **THEN** the transform considers it for linking

#### Scenario: an out-of-window video produces no link

- **WHEN** a video was published before the period started or after it ended
- **THEN** no coverage link is emitted for it, even when it names an officer who resolves at the agency

#### Scenario: the period moves with the run

- **WHEN** a later acquisition runs
- **THEN** it records a period ending at that later run, and the videos the period has rolled past stop producing links

#### Scenario: evidence without a recorded period fails

- **WHEN** the transform reads an evidence envelope that records no acquisition period
- **THEN** the run fails instead of emitting links it cannot bound

### Requirement: A link requires a definite existing officer at an existing agency

A video MUST produce links only when it resolves to at least one officer who
already exists at the agency the acquire searched for, which already exists in
the database. The source MUST NOT create an officer or an agency from a video,
MUST NOT resolve an agency from free text, and MUST emit no link for an absent or
ambiguous officer match. Every emitted officer link MUST carry the passage that
names the officer. Only links are stored: no video media is downloaded or
retained.

#### Scenario: a named, resolvable officer produces a cited link

- **WHEN** an in-window video names an officer who resolves to exactly one existing officer at the acquired agency
- **THEN** a CoverageLink is emitted for the video and a CoverageLinkAgencyPersonnel links it to that officer, carrying the naming passage

#### Scenario: an absent or ambiguous match is skipped

- **WHEN** a video's officer mention resolves to no existing officer at the acquired agency, or to more than one candidate
- **THEN** no link is emitted for that mention and no officer or agency record is created

#### Scenario: a video naming no officer produces no link

- **WHEN** an in-window video names no officer
- **THEN** no CoverageLink is emitted for it

#### Scenario: agency identity is the acquired agency's source id

- **WHEN** two agencies in different states share a name
- **THEN** their acquired videos stay separate, each resolved only against its own agency's roster

### Requirement: Skipped videos are reconsidered while they stay in the period

Acquired videos MUST be retained for as long as they are inside the rolling
period, and every run MUST re-resolve them. A video skipped for an absent or
ambiguous match MUST produce its link on a later run once the matching officer
and agency exist, with no manual re-acquisition.

#### Scenario: a later run picks up a previously skipped video

- **WHEN** a video was skipped for an unresolvable officer, and a later run finds that officer at the acquired agency
- **THEN** that run emits the coverage link and the officer link for the video

#### Scenario: re-running unchanged source and database state does not duplicate

- **WHEN** the transform runs again on unchanged evidence against unchanged database state
- **THEN** it returns the same records, keyed by the stable YouTube video id, so the import upserts rather than inserting duplicates
