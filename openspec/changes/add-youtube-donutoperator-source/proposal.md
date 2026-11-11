## Why

Donut Operator is rank 2 of the six accountability YouTube channels in issue #52,
and the first one added under the board's **link-eligibility contract** (INS-46):

- only videos published inside a **rolling five-year window** ending at the run,
- a link only where the video is **definitively linked to an officer already in
  the database and to that officer's agency, also already in the database**,
- **no officer or agency is ever created** from a video,
- an unmatched or ambiguous video is skipped **for that run only** and is
  reconsidered automatically on later runs,
- links only; **no video media is ingested or stored**.

`youtube.policeactivity` already established the shape that satisfies the officer
and agency halves of this contract, and this change reuses it deliberately rather
than inventing a second one. The rolling window is new, and it is the part that
needed design: a window that moves is not a config floor.

## What Changes

**New source `sources/youtube.donutoperator/` (acquire + transform)**

- From: no Donut Operator ingestion; the eligibility contract existed only as
  board prose.
- To: `acquire.ts` pins the channel by immutable id, pages agencies via the
  `data.agencies(...)` facade, and searches **within the channel** per agency per
  year inside the rolling window; `transform.ts` re-applies the window per video,
  extracts candidate officer names, resolves them against the **acquired agency's**
  roster via `resolvePersonnel`, and emits `CoverageLink` +
  `CoverageLinkAgencyPersonnel` only for videos with at least one resolved
  officer.
- Reason: ingest rank-2 channel coverage under the board's contract.
- Impact: additive namespace `youtube.donutoperator`. No schema, registry,
  migration, or envelope change — both emitted kinds already exist.

**Agency existence is satisfied structurally, not by matching**

The agency on a link is never parsed from video text. Acquire _starts_ from
agencies the database already has and stamps each hit with that agency's
source id, so "the officer's agency already exists" is true by construction and
there is no agency-name matching code path to get wrong. The only free-text
inference left in the pipeline is the officer _candidate_ name, and that is
decided by the intake-owned resolver (ADR 0022/0023), which answers `null` for
both "no match" and "ambiguous".

**Rolling window, enforced at emit time**

- `WINDOW_YEARS = 5` is a constant, not an env knob: the board fixed it, and
  `YOUTUBE_MIN_YEAR` (which widens the sibling sources' backfill) is ignored here.
- The window is re-applied in `transform`, not only in `acquire`, because the
  acquired archive outlives any one run. A video that has aged past five years
  stops producing a link on the next run even though it is still cached.
- Acquire schedules **backfill before refresh** across all agencies, so
  re-checking the current year can never consume the daily quota that agencies
  with no coverage at all are waiting for.
- A publication time is validated for shape before parsing. `new Date(…)` is
  lenient enough to read `"sometime in 2024"` as an instant inside the window; a
  date we only think we understand must not make a video eligible.

**Skip-and-reconsider is a property of the archive, not a queue**

Nothing records "this video was skipped." Acquire keeps every in-window video it
has seen, and transform re-resolves all of them on every run, so a video skipped
for a missing officer is picked up automatically on the first run after that
officer exists, with no backlog to maintain and nothing to replay.

**Shared `sources/lib/officer-mentions.ts`**

The candidate-name regex is extracted from `youtube.policeactivity` into
`sources/lib/`, with its own tests, and both sources now use it. It is the most
safety-critical guess in the pipeline; six channels each carrying a private copy
would be six unreviewed gates on claims about named people.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — already documented.
- `YOUTUBE_WINDOW_NOW` (optional) — pins the window's end instant to re-derive a
  past run's emission; fails loudly when unparseable.

## Not in this change

- **Nothing becomes publicly visible.** Officer-attached coverage is personnel
  data; it stays behind the internal flag until the Data Integrity & Publication
  Risk Reviewer gate clears.
- **The channel id is still board-supplied and unverified against YouTube**
  (INS-53 — no `YOUTUBE_API_KEY` provisioned). Acquire's first real call is that
  check and it refuses to proceed on a mismatch, so the wrong channel cannot be
  ingested quietly — but until a keyed run happens the id rests on the board's
  word.
- **Suppressing a link whose video was deleted or made private.** A video that
  disappears is simply absent from later runs; whether absence should _retract_ a
  stored link is takedown mechanics, not loader behaviour.
