## MODIFIED Requirements

### Requirement: The source resolves and preserves one stable channel identity

Each channel source MUST declare its channel's YouTube channel id and handle in
its checked-in config. Every search MUST use the declared channel id. Before any
video search, acquire MUST resolve the declared handle
(`channels?part=id&forHandle=`) and MUST fail the run loudly, naming both ids,
when the handle resolves to no channel or to an id other than the declared one.
Acquire MUST fail on a search hit whose `channelId` is not the declared id, and
the produce phase MUST fail on an evidence file holding such a video. The source
MUST NOT persist a resolved channel id in its state.

#### Scenario: the handle resolves to the declared channel id

- **WHEN** acquire runs and the declared handle resolves to the declared channel id
- **THEN** the run searches that channel id

#### Scenario: a handle that resolves elsewhere halts the run

- **WHEN** the declared handle resolves to a channel id other than the declared one
- **THEN** the run fails loudly, naming both ids, and acquires nothing

#### Scenario: an unresolvable handle halts the run

- **WHEN** the declared handle resolves to no channel
- **THEN** the run fails loudly and acquires nothing

#### Scenario: a video from another channel is rejected

- **WHEN** a search hit, or a video in an evidence file, carries a `channelId` other than the declared one
- **THEN** acquire or the produce phase fails loudly, naming the video and both ids, and emits no link from it

#### Scenario: a fresh workspace uses the declared id

- **WHEN** acquire runs in a workspace with no state for the source
- **THEN** it searches the declared channel id, and no channel id is written to the source's state

## ADDED Requirements

### Requirement: Every YouTube channel is a config of one shared source

Each YouTube channel MUST be a source folder `sources/com/youtube/<channel>/`
whose `intake.source.ts` passes one channel config (channel id, handle, source
name) to the shared YouTube channel source. The source's namespace MUST be its
folder path. The shared source MUST NOT branch on channel, handle, or source ID;
every requirement of this capability applies to every configured channel. A
config with a missing, blank, or unknown field MUST fail when the source loads.

#### Scenario: two channels keep separate state and namespaces

- **WHEN** `com/youtube/policeactivity` and `com/youtube/lawandcrime` both acquire
- **THEN** each writes its own video cache and evidence under its own namespace, and each `CoverageLinks` record carries its own channel's source name

#### Scenario: a malformed config fails at load

- **WHEN** a channel's `intake.source.ts` config lacks the channel id, or holds an unknown field
- **THEN** loading the source fails, naming the source, before any request is sent

### Requirement: The video cache is never pruned and only a missing cache reads as empty

Acquire MUST keep every cached year and video, including those outside the
current window; the window MUST be applied when evidence is written and read.
Loading the video cache MUST yield an empty cache only when the cache file does
not exist; any other read error, a file that is not JSON, or a file that does
not match the cache shape MUST fail the run.

#### Scenario: a year that leaves the window stays cached

- **WHEN** a cached year falls outside the window of a later run
- **THEN** the year stays in the cache, and its videos are left out of that run's evidence

#### Scenario: an unreadable cache fails the run

- **WHEN** the video cache file exists but cannot be read or parsed
- **THEN** acquire fails loudly, naming the file, and does not start from an empty cache
